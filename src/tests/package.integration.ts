import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  fixtureRoot,
  run,
  write,
  snapshot,
  packageVersion,
  temporary,
  edit,
  objectValue,
} from "./helpers.ts";
import {
  command,
  execute,
  packagingSource,
  installPackage,
  installTarball,
  inspectTarball,
  verifyInstallation,
} from "./package-helpers.ts";

void test(
  "tarball installs and uses its own full templates with packaging source unavailable",
  { timeout: 600000 },
  async (t) => {
    const supplied = process.env.VF_TARBALL;
    let prepared;
    let temp: string;
    if (supplied !== undefined) {
      assert(supplied.trim(), "VF_TARBALL must not be empty");
      temp = await temporary(t);
      const tarball = path.resolve(supplied);
      const bytes = await fs.readFile(tarball);
      t.after(async () => assert.deepEqual(await fs.readFile(tarball), bytes));
      const { names } = await inspectTarball(tarball, temp);
      t.diagnostic(`Tarball SHA-256: ${createHash("sha256").update(bytes).digest("hex")}`);
      t.diagnostic(
        `Tarball integrity: sha512-${createHash("sha512").update(bytes).digest("base64")}`,
      );
      prepared = await installTarball(tarball, temp, names);
    } else {
      const packaging = await packagingSource(t);
      temp = packaging.temp;
      prepared = await installPackage(packaging.source, temp);
    }
    const { install, names, tarball } = prepared;
    const executable = await verifyInstallation(install, temp, names);
    const custom = path.join(temp, "custom");
    await fs.mkdir(custom);
    command(
      executable,
      ["init", custom, "--profile", "strict", "--documents-root", "project/docs"],
      temp,
    );
    const customFiles = await snapshot(custom);
    command(executable, ["init", custom, "--documents-root=project//docs/"], temp);
    assert.deepEqual(await snapshot(custom), customFiles);
    for (const rejected of ["other", "../outside"]) {
      const result = run(["init", custom, "--documents-root", rejected], temp, executable);
      assert.equal(result.status, 2, result.text);
      assert.match(result.stderr, /E_CONFIG/);
      assert.deepEqual(await snapshot(custom), customFiles);
    }
    command(executable, ["new", "Custom root"], custom);
    await fs.access(path.join(custom, "project/docs/changes/change-000001/plan.md"));

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
    // The installed CLI must index an archived, cancelled bundle and reserve its ID.
    await edit(target, "viaferrata/changes/change-000001/plan.md", (text) =>
      text.replace("execution: not_started", "execution: cancelled"),
    );
    await fs.mkdir(path.join(target, "viaferrata/archive/changes"), { recursive: true });
    await fs.rename(generated, path.join(target, "viaferrata/archive/changes/change-000001"));
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
    const next = command(movedExecutable, ["new", "После архивирования"], consumerCwd);
    assert.match(next, /change-000002/);
    const journalTemplate = await fs.readFile(
      path.join(movedPackage, "templates/journal.md"),
      "utf8",
    );
    await write(
      target,
      "viaferrata/changes/change-000002/journal.md",
      journalTemplate
        .replaceAll("{{change_id}}", "change-000002")
        .replaceAll("{{title}}", "Проверка")
        .replaceAll("{{date}}", "2026-11-23"),
    );
    assert.match(
      command(movedExecutable, ["summary", "change-000002"], consumerCwd),
      /Записанных проверок: 0/,
    );
    const digest = command(
      movedExecutable,
      ["scope", "change-000002", "--digest"],
      consumerCwd,
    ).trim();
    assert.match(digest, /^[a-f0-9]{64}$/);
    command("git", ["init", "-q"], target);
    command("git", ["add", "."], target);
    command(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base"],
      target,
    );
    const base = command("git", ["rev-parse", "HEAD"], target).trim();
    await edit(target, "viaferrata/changes/change-000002/journal.md", (text) =>
      text.replace(
        "decisions: []",
        `decisions: ["Область согласована"]\nscope_check:\n  base: "${base}"\n  digest: "${digest}"`,
      ),
    );
    assert.match(
      command(movedExecutable, ["scope", "change-000002"], consumerCwd),
      /Scope проверен/,
    );
    const planPath = path.join(target, "viaferrata/changes/change-000002/plan.md");
    const draftPlan = await fs.readFile(planPath);
    const completion = run(["complete", "change-000002"], consumerCwd, movedExecutable);
    assert.notEqual(completion.status, 0);
    assert.doesNotMatch(completion.stderr, /E_USAGE|E_INTERNAL/);
    assert.deepEqual(await fs.readFile(planPath), draftPlan);
    await verifyLaunchModes(temp, tarball);
    const workflow = path.join(movedPackage, "instructions/workflow.md");
    await fs.rename(workflow, workflow + ".unavailable");
    const empty = path.join(temp, "missing-resource-target");
    await fs.mkdir(empty);
    const failed = run(["init", empty, "--profile", "lite"], temp, movedExecutable);
    assert.equal(failed.status, 2, failed.text);
    assert.match(failed.stderr, /E_IO/);
    assert.deepEqual(await fs.readdir(empty), []);
    await fs.rename(workflow + ".unavailable", workflow);
    if (supplied === undefined) {
      await verifyRejectedArchives(movedPackage, temp);
    }
  },
);

async function verifyLaunchModes(temp: string, tarball: string) {
  const prefix = path.join(temp, "global-prefix");
  command(
    "npm",
    [
      "install",
      "--global",
      "--prefix",
      prefix,
      "--cache",
      path.join(temp, "global-cache"),
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      tarball,
    ],
    temp,
    180000,
  );

  const movedPrefix = path.join(temp, "moved-global-prefix");
  await fs.rename(prefix, movedPrefix);
  const version = await packageVersion();
  for (const mode of ["npx", "global"]) {
    const target = path.join(temp, `${mode}-consumer`);
    await write(target, "notes.txt", "Сохранить\n");
    const cache = path.join(temp, `${mode}-session-cache`);
    await fs.mkdir(cache);
    assert.deepEqual(await fs.readdir(cache), []);
    const env = {
      ...process.env,
      PATH: `${path.join(movedPrefix, "bin")}${path.delimiter}${process.env.PATH ?? ""}`,
    };
    const invoke = (args: string[], cwd = target) =>
      mode === "npx"
        ? execute(
            "npx",
            ["--yes", "--ignore-scripts", "--cache", cache, `--package=${tarball}`, "vf", ...args],
            cwd,
            180000,
          )
        : execute("vf", args, cwd, 30000, env);
    const ok = (args: string[], cwd = target) => {
      const result = invoke(args, cwd);
      assert.equal(result.status, 0, result.text);
      return result.stdout;
    };
    assert.equal(ok(["--version"]).trim(), version);
    const help = ok(["--help"]);
    const resource = help.match(/^Инструкции: (.+)$/m)?.[1];
    assert(resource, help);
    assert((await fs.readFile(resource, "utf8")).length > 0);
    const templates = help.match(/^Руководство форм: (.+)$/m)?.[1];
    assert(templates, help);
    assert((await fs.readFile(templates, "utf8")).length > 0);
    ok(["init", target, "--profile", "lite"], temp);
    const connected = await snapshot(target);
    ok(["init", target], temp);
    assert.deepEqual(await snapshot(target), connected);
    const nested = path.join(target, "work/nested");
    await fs.mkdir(nested, { recursive: true });
    // Each invocation is a new process; no previous help path is passed to it.
    assert.equal(ok(["--help"], nested), help);
    for (const filename of ["package.json", "package-lock.json", "node_modules"]) {
      await assert.rejects(fs.access(path.join(target, filename)), { code: "ENOENT" });
    }
  }
}

async function verifyRejectedArchives(packageRoot: string, temp: string) {
  for (const variant of ["version", "contents", "resource"]) {
    const source = path.join(temp, `invalid-${variant}`);
    await fs.cp(packageRoot, source, { recursive: true });
    if (variant === "version") {
      await edit(source, "package.json", (text) => {
        const pkg: unknown = JSON.parse(text);
        objectValue(pkg);
        pkg.version = "0.0.0-invalid";
        return JSON.stringify(pkg);
      });
    } else if (variant === "contents") {
      await write(source, "docs/unexpected.md", "must not ship");
      await edit(source, "package.json", (text) => {
        const pkg: unknown = JSON.parse(text);
        objectValue(pkg);
        assert(Array.isArray(pkg.files));
        pkg.files.push("docs");
        return JSON.stringify(pkg);
      });
    } else {
      await fs.rename(
        path.join(source, "instructions/workflow.md"),
        path.join(source, "workflow.unavailable"),
      );
    }
    command(
      "npm",
      [
        "pack",
        "--ignore-scripts",
        "--pack-destination",
        source,
        "--cache",
        path.join(temp, "negative-cache"),
      ],
      source,
    );
    const filename = (await fs.readdir(source)).find((name) => name.endsWith(".tgz"));
    assert(filename);
    await assert.rejects(
      inspectTarball(path.join(source, filename), temp),
      variant === "version"
        ? /Unexpected package version/
        : variant === "contents"
          ? /docs\/unexpected.md/
          : /instructions\/workflow.md/,
    );
  }
}
