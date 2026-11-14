import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../config.ts";
import { CommandError } from "../diagnostics.ts";
import { project, run, snapshot, repo } from "../tests/helpers.ts";
import type { ChangeIO } from "./new.ts";
import { createChange } from "./new.ts";

void test("new directly satisfies metadata expectations using packaged full templates", async (t) => {
  const root = await project(t, false);
  const result = await createChange(await loadConfig(root), "Задача *с Markdown*", {
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
    (e) => e instanceof CommandError && e.code === "E_EXISTS",
  );
  assert.equal(await fs.readFile(path.join(target, "intent.md"), "utf8"), "other owner");
});

void test("write failure reports and preserves exact partial result; next attempt skips ID", async (t) => {
  const root = await project(t, false);
  const config = await loadConfig(root);
  const io: ChangeIO = {
    ...fs,
    open: async (file, flags) => {
      if (file.endsWith("/spec.md")) {
        const error = Object.assign(new Error("simulated ENOSPC"), {
          code: "ENOSPC",
        });
        throw error;
      }
      return fs.open(file, flags);
    },
  };
  await assert.rejects(
    createChange(config, "Partial", { io }),
    (e) =>
      e instanceof CommandError &&
      e.code === "E_IO" &&
      /intent.md/.test(e.message) &&
      !/создано:.*spec.md/.test(e.message),
  );
  assert.deepEqual(await fs.readdir(path.join(root, "viaferrata/changes/change-000001")), [
    "intent.md",
  ]);
  assert.equal((await createChange(config, "Next")).id, "change-000002");
});

void test("template failure causes no project writes; updated templates do not regenerate old documents", async (t) => {
  const root = await project(t, false);
  const config = await loadConfig(root);
  const before = await snapshot(root);
  await assert.rejects(
    createChange(config, "Missing", { templates: path.join(root, "missing") }),
    (e) => e instanceof CommandError && e.code === "E_IO",
  );
  assert.deepEqual(await snapshot(root), before);
  const templates = path.join(root, "library");
  await fs.cp(path.join(repo, "templates"), templates, { recursive: true });
  await createChange(config, "First", { templates });
  const old = await snapshot(path.join(root, "viaferrata"));
  await fs.appendFile(path.join(templates, "intent.md"), "\nNew library text.\n");
  await createChange(config, "Second", { templates });
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
      createChange(await loadConfig(root), "Unknown parameter", { templates }),
      (error) => error instanceof CommandError && error.code === "E_UNSUPPORTED",
    );
    assert.deepEqual(await snapshot(root), before);
  });
}
