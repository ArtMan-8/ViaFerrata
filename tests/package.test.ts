import test from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  repo,
  fixtureRoot,
  temporary,
  run,
  write,
  snapshot,
} from "./helpers.ts";
import { assertLocalLinks } from "./document-links.ts";

function execute(
  program: string,
  args: string[],
  cwd: string,
  env = process.env,
) {
  const childEnv = { ...env };
  // npm 11 exports .npmrc allow-scripts as an env option during npm test,
  // then rejects that env option in nested local installs. The explicit
  // --ignore-scripts below disables all lifecycle scripts in this smoke test.
  if (program === "npm")
    for (const key of Object.keys(childEnv)) {
      if (/^npm_config_allow[_-]scripts$/i.test(key)) delete childEnv[key];
    }
  const result = spawnSync(program, args, {
    cwd,
    env: childEnv,
    encoding: "utf8",
    timeout: 90000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  return { ...result, text: result.stdout + result.stderr };
}

function command(program: string, args: string[], cwd: string) {
  const result = execute(program, args, cwd);
  assert.equal(result.status, 0, result.text);
  return result.stdout;
}

async function packagingSource(t: TestContext) {
  const temp = await temporary(t);
  const source = path.join(temp, "pack-source");
  await fs.mkdir(source);
  for (const name of [
    "package.json",
    "package-lock.json",
    "bin",
    "src",
    "scripts",
    "tests",
    "tsconfig.json",
    "tsconfig.build.json",
    "templates",
    "instructions",
    "README.md",
    "LICENSE",
    "viaferrata.toml",
    "node_modules",
  ]) {
    // Copy installed build dependencies too: no symlinks back to the checkout.
    await fs.cp(path.join(repo, name), path.join(source, name), {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
  }
  assert.equal(
    await fs.stat(path.join(source, "dist")).catch(() => null),
    null,
  );
  return { temp, source };
}

test(
  "tarball installs and uses its own full templates with packaging source unavailable",
  { timeout: 120000 },
  async (t) => {
    const { temp, source } = await packagingSource(t);
    // Sentinels ensure the files allowlist really excludes project and test data.
    await write(source, "viaferrata/changes/private.md", "must not ship");
    await write(source, "tests/private.txt", "must not ship");
    await write(source, ".viaferrata/log.txt", "must not ship");
    const npmArgs = [
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--logs-dir",
      path.join(temp, "npm-logs"),
    ];
    // --ignore-scripts skips prepack, so explicitly build this fresh source first.
    command("npm", ["run", "build"], source);
    const [dry]: { files: { path: string }[] }[] = JSON.parse(
      command("npm", ["pack", "--dry-run", "--json", ...npmArgs], source),
    );
    const names = dry.files.map((f) => f.path);
    for (const name of [
      "dist/bin/vf.js",
      "dist/src/documents/schema.js",
      "dist/src/cli/main.js",
      "dist/src/commands/init.js",
      "templates/intent.md",
      "templates/spec.md",
      "templates/plan.md",
      "templates/journal.md",
      "templates/srs.md",
      "templates/research.md",
      "templates/adr.md",
      "templates/README.md",
      "instructions/workflow.md",
      "package.json",
      "LICENSE",
    ])
      assert(names.includes(name), name);
    assert(
      names.every((n) =>
        /^(dist\/(?:bin|src)\/(?:[^/]+\/)*[^/]+\.js$|templates\/|instructions\/|README\.md$|LICENSE$|package\.json$)/.test(
          n,
        ),
      ),
      names.join("\n"),
    );
    const [packed]: { filename: string }[] = JSON.parse(
      command(
        "npm",
        ["pack", "--json", "--pack-destination", temp, ...npmArgs],
        source,
      ),
    );
    const install = path.join(temp, "installed");
    await fs.mkdir(install);
    const cache = path.join(temp, "install-cache");
    await fs.mkdir(cache);
    assert.deepEqual(await fs.readdir(cache), []);
    command(
      "npm",
      [
        "install",
        "--omit=dev",
        "--offline=false",
        "--prefer-offline=false",
        "--cache",
        cache,
        "--fetch-retries=0",
        "--fetch-timeout=30000",
        "--prefix",
        install,
        path.join(temp, packed.filename),
        ...npmArgs,
      ],
      temp,
    );
    await fs.rename(source, source + "-unavailable");
    assert.equal(await fs.stat(source).catch(() => null), null);
    for (const name of ["typescript", "@types/node", "@typescript"]) {
      await assert.rejects(
        fs.access(path.join(install, "node_modules", name)),
        { code: "ENOENT" },
      );
    }
    const packageRoot = path.join(install, "node_modules/viaferrata");
    for (const name of ["instructions/workflow.md", "templates/README.md"]) {
      assert(
        (await fs.readFile(path.join(packageRoot, name), "utf8")).length > 0,
      );
    }
    const bin = path.join(packageRoot, "dist/bin/vf.js");
    assert.match(await fs.readFile(bin, "utf8"), /^#!\/usr\/bin\/env node/);
    assert((await fs.stat(bin)).mode & 0o111);
    await assertLocalLinks(
      path.join(install, "node_modules/viaferrata"),
      names,
    );
    const executable = path.join(install, "node_modules/.bin/vf");
    const version = JSON.parse(
      await fs.readFile(path.join(repo, "package.json"), "utf8"),
    ).version;
    assert.equal(command(executable, ["--version"], temp).trim(), version);
    const help = command(executable, ["--help"], temp);
    assert.match(help, /init/);
    for (const resource of ["instructions/workflow.md", "templates/README.md"])
      assert(help.includes(path.join(packageRoot, resource)));
    const target = path.join(temp, "consumer");
    await write(target, "notes.txt", "Ручной текст проекта\n");
    await write(target, "README.md", "Описание проекта\n");
    await write(target, "AGENTS.md", "# Правила проекта\nРучной текст\n");
    await write(target, ".gitignore", "node_modules/\n");
    const initialized = command(
      executable,
      ["--root", target, "init", "--profile", "lite"],
      temp,
    );
    assert.match(initialized, /Подключение подготовлено/);
    assert(
      (await fs.readFile(path.join(target, "AGENTS.md"), "utf8")).startsWith(
        "# Правила проекта\nРучной текст\n",
      ),
    );
    const connected = await snapshot(target);
    command(executable, ["--root", target, "init"], temp);
    assert.deepEqual(await snapshot(target), connected);
    const original = await snapshot(target);
    const created = run(
      ["--root", target, "new", "Library template"],
      temp,
      executable,
    );
    assert.equal(created.status, 0, created.text);
    const generated = path.join(target, "viaferrata/changes/change-000001");
    assert.deepEqual((await fs.readdir(generated)).sort(), [
      "intent.md",
      "plan.md",
      "spec.md",
    ]);
    const intent = await fs.readFile(path.join(generated, "intent.md"), "utf8");
    assert.match(intent, /## Examples/);
    assert.match(intent, /<!-- optional:/);
    assert.match(intent, /# optional:/);
    const draft = run(["--root", target, "validate"], temp, executable);
    assert.equal(draft.status, 1, draft.text);
    assert.match(draft.text, /E_DRAFT_PLACEHOLDER/);
    // An independently authored, filled contract replaces the draft; no generator-derived oracle.
    for (const type of ["intent", "spec", "plan"]) {
      const independent = await fs.readFile(
        path.join(
          fixtureRoot,
          "base/viaferrata/changes/change-000042",
          `${type}.md`,
        ),
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
      { recursive: true },
    );
    const beforeValidation = await snapshot(target);
    const checked = run(["--root", target, "validate"], temp, executable);
    assert.equal(checked.status, 0, checked.text);
    assert.match(checked.text, /Полная поддержка lite\/strict отсутствует/);
    assert.deepEqual(await snapshot(target), beforeValidation);
    const after = await snapshot(target);
    for (const name of Object.keys(original))
      assert.deepEqual(after[name], original[name]);
    command(executable, ["--root", target, "init"], temp);
    command(executable, ["--root", target, "validate"], temp);
    assert.deepEqual(await snapshot(target), after);

    // A different installation path must not require rewriting project navigation.
    const moved = path.join(temp, "moved-installation");
    await fs.rename(install, moved);
    const movedExecutable = path.join(moved, "node_modules/.bin/vf");
    const movedPackage = path.join(moved, "node_modules/viaferrata");
    const movedOutput = command(
      movedExecutable,
      ["--root", target, "init"],
      temp,
    );
    assert(
      movedOutput.includes(path.join(movedPackage, "instructions/workflow.md")),
    );
    assert.deepEqual(await snapshot(target), after);
    const workflow = path.join(movedPackage, "instructions/workflow.md");
    await fs.rename(workflow, workflow + ".unavailable");
    const empty = path.join(temp, "missing-resource-target");
    await fs.mkdir(empty);
    const failed = run(
      ["--root", empty, "init", "--profile", "lite"],
      temp,
      movedExecutable,
    );
    assert.equal(failed.status, 2, failed.text);
    assert.match(failed.stderr, /E_IO/);
    assert.deepEqual(await fs.readdir(empty), []);
    await fs.rename(workflow + ".unavailable", workflow);
  },
);

test(
  "clean build and prepack reject type errors and never reuse stale output",
  { timeout: 120000 },
  async (t) => {
    const { temp, source } = await packagingSource(t);
    const entry = path.join(source, "bin/vf.ts");
    assert.match(command(process.execPath, [entry, "--help"], temp), /new/);
    command(
      process.execPath,
      [path.join(source, "scripts/input-manifest.ts")],
      temp,
    );
    await write(source, "src/obsolete.ts", "export const obsolete = true;\n");
    command("npm", ["run", "build"], source);
    await fs.access(path.join(source, "dist/src/obsolete.js"));
    await fs.unlink(path.join(source, "src/obsolete.ts"));
    await fs.appendFile(
      path.join(source, "src/cli/main.ts"),
      '\nexport const buildMarker = "fresh source";\n',
    );
    await write(
      source,
      "dist/src/cli/main.js",
      'throw new Error("stale build");\n',
    );
    command(
      "npm",
      ["pack", "--ignore-scripts=false", "--pack-destination", temp],
      source,
    );
    await assert.rejects(fs.access(path.join(source, "dist/src/obsolete.js")), {
      code: "ENOENT",
    });
    assert.match(
      await fs.readFile(path.join(source, "dist/src/cli/main.js"), "utf8"),
      /fresh source/,
    );
    assert.match(
      command(
        process.execPath,
        [path.join(source, "dist/bin/vf.js"), "--help"],
        temp,
      ),
      /new/,
    );
    const packed = path.join(temp, "viaferrata-0.1.0.tgz");
    await fs.access(packed);
    await fs.unlink(packed);

    // Each code directory must participate in the separate strict type check.
    for (const directory of ["bin", "src", "tests", "scripts"]) {
      const probe = `${directory}/typecheck-probe.ts`;
      await write(source, probe, "export const invalid: string = 42;\n");
      const checked = execute("npm", ["run", "typecheck"], source);
      assert.notEqual(checked.status, 0, checked.text);
      assert.match(checked.text, /typecheck-probe\.ts.*error TS/);
      await fs.unlink(path.join(source, probe));
    }
    await write(
      source,
      "tests/typecheck-probe.ts",
      "export const invalid: string = 42;\n",
    );
    const failedBuild = execute("npm", ["run", "build"], source);
    assert.notEqual(failedBuild.status, 0, failedBuild.text);
    await assert.rejects(fs.access(path.join(source, "dist")), {
      code: "ENOENT",
    });
    const failedPack = execute(
      "npm",
      ["pack", "--ignore-scripts=false", "--pack-destination", temp],
      source,
    );
    assert.notEqual(failedPack.status, 0, failedPack.text);
    await assert.rejects(fs.access(packed), { code: "ENOENT" });
  },
);
