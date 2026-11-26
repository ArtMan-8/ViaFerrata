import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../config.ts";
import { CommandError } from "../diagnostics.ts";
import { project, run, snapshot, repo, write } from "../tests/helpers.ts";
import type { ChangeIO } from "./new.ts";
import { createDraft } from "./new.ts";

void test("new directly satisfies metadata expectations using packaged full templates", async (t) => {
  const root = await project(t, false);
  const result = await createDraft(await loadConfig(root), "change", "Задача *с Markdown*", {
    now: () => new Date("2026-11-12T00:00:01Z"),
  });
  assert.equal(result.id, "change-000001");
  const dir = path.join(root, "viaferrata/changes/change-000001");
  assert.deepEqual((await fs.readdir(dir)).sort(), ["intent.md", "plan.md", "spec.md"]);
  for (const type of ["intent", "spec", "plan"]) {
    const text = await fs.readFile(path.join(dir, type + ".md"), "utf8");
    assert(text.includes(`id: "change-000001/${type}"`));
    assert.match(text, /status: draft/);
    assert.match(text, /created: "2026-11-12"\nupdated: "2026-11-12"/);
    assert(text.includes("# Задача \\*с Markdown\\*"));
    assert.match(text, /# optional:/);
    assert.match(text, /<!-- optional:/);
    assert(!text.includes("{{"));
    if (type === "plan") {
      assert.match(text, /execution: not_started/);
    }
  }
  const checked = run(["validate"], root);
  assert.equal(checked.status, 1, checked.text);
  assert.match(checked.text, /E_DRAFT_PLACEHOLDER/);
  assert(!checked.text.includes("E_REFERENCE_TARGET"), checked.text);
  assert(!checked.text.includes("E_STRUCTURE"), checked.text);
});

void test("exclusive-create conflict never overwrites another owner", async (t) => {
  const root = await project(t, false);
  const config = await loadConfig(root);
  const target = path.join(root, "viaferrata/changes/change-000001");
  const io: ChangeIO = {
    ...fs,
    rename: async (source, destination) => {
      await fs.mkdir(target);
      await fs.writeFile(path.join(target, "intent.md"), "other owner");
      await fs.rename(source, destination);
    },
  };
  await assert.rejects(
    createDraft(config, "change", "Conflict", { io }),
    (e) => e instanceof CommandError && e.code === "E_CONFLICT",
  );
  assert.equal(await fs.readFile(path.join(target, "intent.md"), "utf8"), "other owner");
});

for (const type of ["change", "srs"] as const) {
  void test(`failed ${type} write leaves no published draft and permits retry`, async (t) => {
    const config = await loadConfig(await project(t, false));
    const io: ChangeIO = {
      ...fs,
      open: async (file, flags) => {
        if (file.endsWith(type === "change" ? "/spec.md" : "/srs.md")) {
          throw Object.assign(new Error("full"), { code: "ENOSPC" });
        }
        return fs.open(file, flags);
      },
    };
    await assert.rejects(
      createDraft(config, type, "Failure", { io }),
      (e) => e instanceof CommandError && e.code === "E_IO",
    );
    const dir = type === "change" ? "changes" : "specs";
    assert.deepEqual(await fs.readdir(config.directories[dir]), []);
    assert.deepEqual(await fs.readdir(config.documentsRoot), [dir]);
    assert.equal((await createDraft(config, type, "Retry")).id, type + "-000001");
  });

  void test(`two ${type} creators selecting the same ID publish exactly once`, async (t) => {
    const config = await loadConfig(await project(t, false));
    const ready = Promise.withResolvers<void>();
    let arrivals = 0;
    const io: ChangeIO = {
      ...fs,
      mkdtemp: async (prefix: string) => {
        if (++arrivals === 2) {
          ready.resolve();
        }
        await ready.promise;
        return fs.mkdtemp(prefix);
      },
    };
    const results = await Promise.allSettled(
      ["One", "Two"].map((title) => createDraft(config, type, title, { io })),
    );
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
    const failure = results.find((r) => r.status === "rejected");
    assert(failure?.reason instanceof CommandError && failure.reason.code === "E_CONFLICT");
    const dir = type === "change" ? config.directories.changes : config.directories.specs;
    const entries = await fs.readdir(dir);
    assert.equal(entries.length, 1);
    if (type === "change") {
      assert.deepEqual((await fs.readdir(path.join(dir, entries[0]))).sort(), [
        "intent.md",
        "plan.md",
        "spec.md",
      ]);
    } else {
      assert.match(await fs.readFile(path.join(dir, entries[0]), "utf8"), /## Requirements/);
    }
  });
}

void test("standalone allocation uses YAML identities and preserves old forms", async (t) => {
  const root = await project(t, false);
  const config = await loadConfig(root);
  const old =
    "---\nid: srs-000075\nstatus: approved\ncreated: '2026-11-20'\nupdated: '2026-11-20'\n---\n# Legacy\n";
  await write(root, "viaferrata/specs/custom.md", old);
  assert.match(run(["validate"], root).text, /W_FORM/);
  assert.equal((await createDraft(config, "srs", "Working")).id, "srs-000076");
  assert.equal(await fs.readFile(path.join(config.directories.specs, "custom.md"), "utf8"), old);
  await write(
    root,
    "viaferrata/archive/specs/history.md",
    old.replace("000075", "000084").replace("approved", "cancelled"),
  );
  const before = await snapshot(config.documentsRoot);
  const result = await createDraft(config, "srs", "New");
  assert.equal(result.id, "srs-000085");
  assert.match(await fs.readFile(result.created[0], "utf8"), /## System Overview/);
  const after = await snapshot(config.documentsRoot);
  for (const key of Object.keys(before)) {
    assert.deepEqual(after[key], before[key]);
  }
  await write(root, "viaferrata/specs/srs-000086.md", old.replace("000075", "000004"));
  await assert.rejects(
    createDraft(config, "srs", "Collision"),
    (e) => e instanceof CommandError && e.code === "E_CONFLICT",
  );
  assert.equal(
    await fs.readFile(path.join(config.directories.specs, "srs-000086.md"), "utf8"),
    old.replace("000075", "000004"),
  );
  await write(
    root,
    "viaferrata/archive/specs/last.md",
    old.replace("000075", "999999").replace("approved", "cancelled"),
  );
  await assert.rejects(
    createDraft(config, "srs", "Full"),
    (e) => e instanceof CommandError && e.code === "E_ID_EXHAUSTED",
  );
});

void test("template failure causes no project writes; updated templates do not regenerate old documents", async (t) => {
  const root = await project(t, false);
  const config = await loadConfig(root);
  const before = await snapshot(root);
  await assert.rejects(
    createDraft(config, "change", "Missing", { templates: path.join(root, "missing") }),
    (e) => e instanceof CommandError && e.code === "E_IO",
  );
  assert.deepEqual(await snapshot(root), before);
  const templates = path.join(root, "library");
  await fs.cp(path.join(repo, "templates"), templates, { recursive: true });
  await createDraft(config, "change", "First", { templates });
  const old = await snapshot(path.join(root, "viaferrata"));
  await fs.appendFile(path.join(templates, "intent.md"), "\nNew library text.\n");
  await createDraft(config, "change", "Second", { templates });
  const after = await snapshot(path.join(root, "viaferrata"));
  for (const key of Object.keys(old)) {
    assert.deepEqual(after[key], old[key]);
  }
  assert.match(
    await fs.readFile(path.join(root, "viaferrata/changes/change-000002/intent.md"), "utf8"),
    /New library text/,
  );
});

for (const parameter of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
  void test(`new rejects inherited template parameter ${parameter} before writing`, async (t) => {
    const root = await project(t, false);
    const templates = path.join(root, "library");
    await fs.cp(path.join(repo, "templates"), templates, { recursive: true });
    await fs.appendFile(path.join(templates, "intent.md"), `\n{{${parameter}}}\n`);
    const before = await snapshot(root);
    await assert.rejects(
      createDraft(await loadConfig(root), "change", "Unknown parameter", { templates }),
      (error) => error instanceof CommandError && error.code === "E_UNSUPPORTED",
    );
    assert.deepEqual(await snapshot(root), before);
  });
}
