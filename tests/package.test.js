import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { repo, fixtureRoot, temporary, run, write } from "./helpers.js";
import { assertLocalLinks } from "./document-links.js";

function command(program, args, cwd, env = process.env) {
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
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

test(
  "tarball installs and uses its own full templates with packaging source unavailable",
  { timeout: 120000 },
  async (t) => {
    const temp = await temporary(t);
    const source = path.join(temp, "pack-source");
    await fs.mkdir(source);
    for (const name of [
      "package.json",
      "package-lock.json",
      "bin",
      "src",
      "templates",
      "instructions",
      "README.md",
      "LICENSE",
    ]) {
      await fs.cp(path.join(repo, name), path.join(source, name), {
        recursive: true,
        preserveTimestamps: true,
      });
    }
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
    const [dry] = JSON.parse(
      command("npm", ["pack", "--dry-run", "--json", ...npmArgs], source),
    );
    const names = dry.files.map((f) => f.path);
    for (const name of [
      "bin/vf.js",
      "src/schema.js",
      "src/cli.js",
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
        /^(bin\/|src\/|templates\/|instructions\/|README\.md$|LICENSE$|package\.json$)/.test(
          n,
        ),
      ),
      names.join("\n"),
    );
    const [packed] = JSON.parse(
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
    await assertLocalLinks(
      path.join(install, "node_modules/viaferrata"),
      names,
    );
    const executable = path.join(install, "node_modules/.bin/vf");
    const version = JSON.parse(
      await fs.readFile(path.join(repo, "package.json"), "utf8"),
    ).version;
    assert.equal(command(executable, ["--version"], temp).trim(), version);
    assert.match(command(executable, ["--help"], temp), /new/);
    const target = path.join(temp, "consumer");
    await write(target, "viaferrata.toml", 'profile = "lite"\n');
    const created = run(
      ["--root", target, "new", "Library template"],
      temp,
      executable,
    );
    assert.equal(created.status, 0, created.text);
    const generated = path.join(target, "viaferrata/changes/change-000001");
    assert.deepEqual((await fs.readdir(generated)).sort(), ["intent.md", "plan.md", "spec.md"]);
    const intent = await fs.readFile(path.join(generated, "intent.md"), "utf8");
    assert.match(intent, /## Examples/);
    assert.match(intent, /<!-- optional:/);
    assert.match(intent, /# optional:/);
    assert.equal(
      run(["--root", target, "validate"], temp, executable).status,
      1,
    );
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
    const checked = run(["--root", target, "validate"], temp, executable);
    assert.equal(checked.status, 0, checked.text);
    assert.match(checked.text, /Полная поддержка lite\/strict отсутствует/);
  },
);
