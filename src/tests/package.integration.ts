import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { fixtureRoot, run, write, snapshot } from "./helpers.ts";
import { command, packagingSource, installPackage, verifyInstallation } from "./package-helpers.ts";

void test(
  "tarball installs and uses its own full templates with packaging source unavailable",
  { timeout: 240000 },
  async (t) => {
    const { temp, source } = await packagingSource(t);
    const { install, names } = await installPackage(source, temp);
    const executable = await verifyInstallation(install, temp, names);
    const target = path.join(temp, "consumer");
    await write(target, "notes.txt", "Ручной текст проекта\n");
    await write(target, "README.md", "Описание проекта\n");
    await write(target, "AGENTS.md", "# Правила проекта\nРучной текст\n");
    await write(target, ".gitignore", "node_modules/\n");
    const initialized = command(executable, ["init", target, "--profile", "lite"], temp);
    assert.match(initialized, /Подключение подготовлено/);
    assert(
      (await fs.readFile(path.join(target, "AGENTS.md"), "utf8")).startsWith(
        "# Правила проекта\nРучной текст\n",
      ),
    );
    const connected = await snapshot(target);
    command(executable, ["init", target], temp);
    assert.deepEqual(await snapshot(target), connected);
    const consumerCwd = path.join(target, "work", "nested");
    await fs.mkdir(consumerCwd, { recursive: true });
    const original = await snapshot(target);
    const created = run(["new", "Library template"], consumerCwd, executable);
    assert.equal(created.status, 0, created.text);
    const generated = path.join(target, "viaferrata/changes/change-000001");
    assert.deepEqual((await fs.readdir(generated)).sort(), ["intent.md", "plan.md", "spec.md"]);
    const intent = await fs.readFile(path.join(generated, "intent.md"), "utf8");
    assert.match(intent, /## Examples/);
    assert.match(intent, /<!-- optional:/);
    assert.match(intent, /# optional:/);
    const draft = run(["validate"], consumerCwd, executable);
    assert.equal(draft.status, 1, draft.text);
    assert.match(draft.text, /E_DRAFT_PLACEHOLDER/);
    // An independently authored, filled contract replaces the draft; no generator-derived oracle.
    for (const type of ["intent", "spec", "plan"]) {
      const independent = await fs.readFile(
        path.join(fixtureRoot, "base/viaferrata/changes/change-000042", `${type}.md`),
        "utf8",
      );
      await fs.writeFile(
        path.join(generated, `${type}.md`),
        independent.replaceAll("change-000042", "change-000001"),
      );
    }
    await fs.cp(
      path.join(fixtureRoot, "base/viaferrata/specs"),
      path.join(target, "viaferrata/specs"),
      {
        recursive: true,
      },
    );
    const beforeValidation = await snapshot(target);
    const checked = run(["validate"], consumerCwd, executable);
    assert.equal(checked.status, 0, checked.text);
    assert.match(checked.text, /Полная поддержка lite\/strict отсутствует/);
    assert.deepEqual(await snapshot(target), beforeValidation);
    const after = await snapshot(target);
    for (const name of Object.keys(original)) {
      assert.deepEqual(after[name], original[name]);
    }
    command(executable, ["init", target], temp);
    command(executable, ["validate"], consumerCwd);
    assert.deepEqual(await snapshot(target), after);

    // A different installation path must not require rewriting project navigation.
    const moved = path.join(temp, "moved-installation");
    await fs.rename(install, moved);
    const movedExecutable = path.join(moved, "node_modules/.bin/vf");
    const movedPackage = path.join(moved, "node_modules/viaferrata");
    const movedOutput = command(movedExecutable, ["init", target], temp);
    assert(movedOutput.includes(path.join(movedPackage, "instructions/workflow.md")));
    assert.deepEqual(await snapshot(target), after);
    const workflow = path.join(movedPackage, "instructions/workflow.md");
    await fs.rename(workflow, workflow + ".unavailable");
    const empty = path.join(temp, "missing-resource-target");
    await fs.mkdir(empty);
    const failed = run(["init", empty, "--profile", "lite"], temp, movedExecutable);
    assert.equal(failed.status, 2, failed.text);
    assert.match(failed.stderr, /E_IO/);
    assert.deepEqual(await fs.readdir(empty), []);
    await fs.rename(workflow + ".unavailable", workflow);
  },
);
