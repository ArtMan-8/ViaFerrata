import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  project,
  temporary,
  run,
  write,
  edit,
  snapshot,
  repo,
} from "./helpers.js";
import { loadConfig } from "../src/config.js";
import { createChange } from "../src/new.js";

test("help/version and usage work without a project", async (t) => {
  const root = await temporary(t);
  assert.equal(run([], root).status, 0);
  assert.match(run(["--help"], root).text, /vf.*validate/);
  const pkg = JSON.parse(
    await fs.readFile(path.join(repo, "package.json"), "utf8"),
  );
  assert.equal(run(["--version"], root).stdout.trim(), pkg.version);
  for (const args of [
    ["init"],
    ["validate", "extra"],
    ["--root"],
    ["--unknown"],
    ["new", ""],
    ["new", "a\nb"],
    ["--root", root, "--root", root, "validate"],
  ]) {
    const result = run(args, root);
    assert.equal(result.status, 2, result.text);
    assert.match(result.text, /E_USAGE/);
  }
});

test("new directly satisfies metadata expectations using packaged full templates", async (t) => {
  const root = await project(t, false);
  const result = await createChange(
    await loadConfig(root),
    "Задача *с Markdown*",
    { now: () => new Date("2026-11-12T00:00:01Z") },
  );
  assert.equal(result.id, "change-000001");
  const dir = path.join(root, "viaferrata/changes/change-000001");
  assert.deepEqual((await fs.readdir(dir)).sort(), [
    "intent.md",
    "plan.md",
    "spec.md",
  ]);
  for (const type of ["intent", "spec", "plan"]) {
    const text = await fs.readFile(path.join(dir, type + ".md"), "utf8");
    assert(text.includes(`id: "change-000001/${type}"`));
    assert.match(text, /status: draft/);
    assert.match(text, /created: "2026-11-12"\nupdated: "2026-11-12"/);
    assert(text.includes("# Задача \\*с Markdown\\*"));
    assert.match(text, /# optional:/);
    assert.match(text, /<!-- optional:/);
    assert(!text.includes("{{"));
    if (type === "plan") assert.match(text, /execution: not_started/);
  }
  const checked = run(["validate"], root);
  assert.equal(checked.status, 1, checked.text);
  assert.match(checked.text, /E_DRAFT_PLACEHOLDER/);
  assert(!checked.text.includes("E_REFERENCE_TARGET"), checked.text);
  assert(!checked.text.includes("E_STRUCTURE"), checked.text);
});

test("explicit root with spaces selects only that project; cwd has no parent discovery", async (t) => {
  const elsewhere = await project(t, false);
  const container = await temporary(t);
  const root = path.join(container, "project with spaces");
  await write(
    root,
    "viaferrata.toml",
    'profile = "lite"\ndocuments_root = "process"\n',
  );
  const otherBefore = await snapshot(elsewhere);
  assert.equal(run(["--root", root, "new", "Задача"], elsewhere).status, 0);
  assert.deepEqual(await snapshot(elsewhere), otherBefore);
  assert(
    (
      await fs.stat(path.join(root, "process/changes/change-000001/intent.md"))
    ).isFile(),
  );
  const child = path.join(root, "child");
  await fs.mkdir(child);
  assert.match(run(["validate"], child).text, /E_CONFIG/);
  assert.equal(run(["--root", "..", "new", "Ещё задача"], child).status, 0);
});

test("max + 1 preserves occupied files and incomplete directories", async (t) => {
  const root = await project(t, false);
  await write(root, "viaferrata/changes/change-000007", "user-owned");
  await fs.mkdir(path.join(root, "viaferrata/changes/change-000010"));
  const result = run(["new", "Следующая"], root);
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /change-000011/);
  assert.equal(
    await fs.readFile(
      path.join(root, "viaferrata/changes/change-000007"),
      "utf8",
    ),
    "user-owned",
  );
  assert.deepEqual(
    await fs.readdir(path.join(root, "viaferrata/changes/change-000010")),
    [],
  );
  // Existing TODO drafts do not block the lightweight allocation index.
  assert.match(run(["new", "Ещё одна"], root).text, /change-000012/);
});

test("invalid allocation index and exhausted IDs stop before writing", async (t) => {
  const root = await project(t);
  await edit(root, "viaferrata/changes/change-000042/intent.md", (s) =>
    s.replace("id: change-000042/intent", "id: wrong"),
  );
  const before = await snapshot(root);
  const result = run(["new", "Задача"], root);
  assert.equal(result.status, 1);
  assert.match(result.text, /E_ID/);
  assert.deepEqual(await snapshot(root), before);
  const full = await project(t, false);
  await write(full, "viaferrata/changes/change-999999", "occupied");
  const exhausted = run(["new", "Задача"], full);
  assert.equal(exhausted.status, 2);
  assert.match(exhausted.text, /E_ID_EXHAUSTED/);
});

test("exclusive-create conflict never overwrites another owner", async (t) => {
  const root = await project(t, false);
  const config = await loadConfig(root);
  const target = path.join(root, "viaferrata/changes/change-000001");
  const io = {
    ...fs,
    mkdir: async (p) => {
      if (p === target) {
        await fs.mkdir(p);
        await fs.writeFile(path.join(p, "intent.md"), "other owner");
      }
      return fs.mkdir(p);
    },
  };
  await assert.rejects(
    createChange(config, "Conflict", { io }),
    (e) => e.code === "E_EXISTS",
  );
  assert.equal(
    await fs.readFile(path.join(target, "intent.md"), "utf8"),
    "other owner",
  );
});

test("write failure reports and preserves exact partial result; next attempt skips ID", async (t) => {
  const root = await project(t, false);
  const config = await loadConfig(root);
  const io = {
    ...fs,
    open: async (file, flags) => {
      if (file.endsWith("/spec.md")) {
        const error = new Error("simulated ENOSPC");
        error.code = "ENOSPC";
        throw error;
      }
      return fs.open(file, flags);
    },
  };
  await assert.rejects(
    createChange(config, "Partial", { io }),
    (e) =>
      e.code === "E_IO" &&
      /intent.md/.test(e.message) &&
      !/создано:.*spec.md/.test(e.message),
  );
  assert.deepEqual(
    await fs.readdir(path.join(root, "viaferrata/changes/change-000001")),
    ["intent.md"],
  );
  assert.equal((await createChange(config, "Next")).id, "change-000002");
});

test("template failure causes no project writes; updated templates do not regenerate old documents", async (t) => {
  const root = await project(t, false);
  const config = await loadConfig(root);
  const before = await snapshot(root);
  await assert.rejects(
    createChange(config, "Missing", { templates: path.join(root, "missing") }),
    (e) => e.code === "E_IO",
  );
  assert.deepEqual(await snapshot(root), before);
  const templates = path.join(root, "library");
  await fs.cp(path.join(repo, "templates"), templates, { recursive: true });
  await createChange(config, "First", { templates });
  const old = await snapshot(path.join(root, "viaferrata"));
  await fs.appendFile(
    path.join(templates, "intent.md"),
    "\nNew library text.\n",
  );
  await createChange(config, "Second", { templates });
  const after = await snapshot(path.join(root, "viaferrata"));
  for (const key of Object.keys(old)) assert.deepEqual(after[key], old[key]);
  assert.match(
    await fs.readFile(
      path.join(root, "viaferrata/changes/change-000002/intent.md"),
      "utf8",
    ),
    /New library text/,
  );
});

for (const [name, config, expected] of [
  ["malformed TOML", "profile = [", "E_CONFIG"],
  ["unknown key", 'profile = "lite"\nunknown = true\n', "E_CONFIG"],
  ["duplicate key", 'profile = "lite"\nprofile = "strict"\n', "E_CONFIG"],
  ["bad profile", 'profile = "disabled"', "E_CONFIG"],
  ["wrong type", 'profile = "lite"\ndocuments_root = []', "E_CONFIG"],
  [
    "parent escape",
    'profile = "lite"\ndocuments_root = "../other"',
    "E_CONFIG",
  ],
  ["absolute root", 'profile = "lite"\ndocuments_root = "/tmp"', "E_CONFIG"],
  [
    "temporary root",
    'profile = "lite"\ndocuments_root = ".viaferrata"',
    "E_CONFIG",
  ],
  [
    "protected paths",
    'profile = "lite"\nprotected_paths = ["vendor/**"]',
    "E_UNSUPPORTED",
  ],
  [
    "required checks",
    'profile = "lite"\nrequired_checks = ["unit"]',
    "E_UNSUPPORTED",
  ],
])
  test(`config: ${name} stops new before writing`, async (t) => {
    const root = await project(t, false);
    await fs.writeFile(path.join(root, "viaferrata.toml"), config);
    const before = await snapshot(root);
    const result = run(["new", "No write"], root);
    assert.equal(result.status, 2, result.text);
    assert(result.text.includes(expected), result.text);
    assert.deepEqual(await snapshot(root), before);
  });

test("missing config, symlinked root/config/document directory and empty project", async (t) => {
  const missing = await temporary(t);
  assert.match(run(["validate"], missing).text, /E_CONFIG/);
  const root = await project(t, false);
  const empty = run(["validate"], root);
  assert.equal(empty.status, 0);
  assert.match(empty.text, /Документов нет/);
  await fs.symlink(root, path.join(missing, "link"));
  assert.match(
    run(["--root", path.join(missing, "link"), "validate"], missing).text,
    /E_UNSUPPORTED/,
  );
  await fs.symlink(root, path.join(root, "viaferrata"));
  assert.match(run(["new", "No write"], root).text, /E_UNSUPPORTED/);
  const other = await temporary(t);
  await fs.symlink(
    path.join(root, "viaferrata.toml"),
    path.join(other, "viaferrata.toml"),
  );
  assert.match(run(["validate"], other).text, /E_UNSUPPORTED/);
});
