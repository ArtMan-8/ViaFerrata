import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import type { TestContext } from "node:test";

import { assertLocalLinks } from "./document-links.ts";
import {
  repo,
  execute as subprocess,
  objectValue,
  packageVersion,
  temporary,
  write,
} from "./helpers.ts";

export function execute(
  program: string,
  args: string[],
  cwd: string,
  timeout = 90000,
  env = process.env,
) {
  const childEnv = { ...env };
  // npm 11 exports .npmrc allow-scripts as an env option during npm test,
  // then rejects that env option in nested local installs. The explicit
  // --ignore-scripts below disables all lifecycle scripts in this smoke test.
  if (program === "npm" || program === "npx") {
    for (const key of Object.keys(childEnv)) {
      if (/^npm_config_allow[_-]scripts$/i.test(key)) {
        delete childEnv[key];
      }
    }
  }

  return subprocess(program, args, {
    cwd,
    env: childEnv,
    timeout,
    maxBuffer: 4 * 1024 * 1024,
  });
}

export function command(program: string, args: string[], cwd: string, timeout = 90000) {
  const result = execute(program, args, cwd, timeout);
  assert.equal(result.status, 0, result.text);
  return result.stdout;
}

export async function packagingSource(t: TestContext) {
  const temp = await temporary(t);
  const source = path.join(temp, "pack-source");
  await fs.mkdir(source);
  for (const name of [
    "package.json",
    "package-lock.json",
    "bin",
    "src",
    "scripts",
    "tsconfig.json",
    "tsconfig.build.json",
    "templates",
    "instructions",
    "CHANGELOG.md",
    "README.md",
    "LICENSE",
    "node_modules",
  ]) {
    // Copy installed build dependencies too: no symlinks back to the checkout.
    await fs.cp(path.join(repo, name), path.join(source, name), {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
    });
  }

  assert.equal(await fs.stat(path.join(source, "dist")).catch(() => null), null);
  return { temp, source };
}

export async function installPackage(source: string, temp: string) {
  // Sentinels ensure the files allowlist really excludes project and test data.
  await write(source, "viaferrata/changes/private.md", "must not ship");
  await write(source, "src/tests/private.txt", "must not ship");
  await write(source, "docs/quickstart.md", "must not ship");
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
  const packed = await checkPackageContents(
    command("npm", ["pack", "--json", "--pack-destination", temp, ...npmArgs], source),
  );
  const result = await installTarball(path.join(temp, packed.filename), temp, packed.names);
  await fs.rename(source, source + "-unavailable");
  assert.equal(await fs.stat(source).catch(() => null), null);
  return result;
}

async function checkPackageContents(json: string) {
  const packResult: unknown = JSON.parse(json);
  assert(Array.isArray(packResult) && packResult.length === 1);
  const packed: unknown = packResult[0];
  objectValue(packed);
  assert.equal(packed.name, "viaferrata", "Unexpected package name");
  assert.equal(packed.version, await packageVersion(), "Unexpected package version");
  assert(typeof packed.filename === "string");
  assert(Array.isArray(packed.files));
  const names = packed.files.map((file: unknown) => {
    objectValue(file);
    assert(typeof file.path === "string");
    return file.path;
  });

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
    "CHANGELOG.md",
    "README.md",
    "package.json",
    "LICENSE",
  ]) {
    assert(names.includes(name), name);
  }

  assert(
    names.every((n) =>
      /^(dist\/(?:bin|src)\/(?:[^/]+\/)*[^/]+\.js$|templates\/|instructions\/|CHANGELOG\.md$|README\.md$|LICENSE$|package\.json$)/.test(
        n,
      ),
    ),
    names.join("\n"),
  );
  assert(
    !names.some((name) => /(?:\.test\.js$|^dist\/src\/tests\/|^tests\/)/.test(name)),
    names.join("\n"),
  );
  return { filename: packed.filename, names };
}

export async function inspectTarball(tarball: string, temp: string) {
  assert((await fs.stat(tarball)).isFile(), "VF_TARBALL must name a local file");
  return checkPackageContents(
    command(
      "npm",
      [
        "pack",
        tarball,
        "--dry-run",
        "--json",
        "--ignore-scripts",
        "--cache",
        path.join(temp, "inspect-cache"),
      ],
      temp,
    ),
  );
}

export async function installTarball(tarball: string, temp: string, names: string[]) {
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
      "--fetch-retries=1",
      "--fetch-retry-mintimeout=1000",
      "--fetch-retry-maxtimeout=5000",
      "--fetch-timeout=60000",
      "--prefix",
      install,
      tarball,
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--logs-dir",
      path.join(temp, "npm-logs"),
    ],
    temp,
    180000,
  );
  for (const name of [
    "typescript",
    "@types/node",
    "@typescript",
    "oxlint",
    "oxlint-tsgolint",
    "oxfmt",
    "markdownlint-cli2",
  ]) {
    await assert.rejects(fs.access(path.join(install, "node_modules", name)), {
      code: "ENOENT",
    });
  }
  return { install, names, tarball };
}

export async function verifyInstallation(install: string, temp: string, names: string[]) {
  const packageRoot = path.join(install, "node_modules/viaferrata");
  for (const name of ["instructions/workflow.md", "templates/README.md"]) {
    assert((await fs.readFile(path.join(packageRoot, name), "utf8")).length > 0);
  }

  const bin = path.join(packageRoot, "dist/bin/vf.js");
  assert.match(await fs.readFile(bin, "utf8"), /^#!\/usr\/bin\/env node/);
  assert((await fs.stat(bin)).mode & 0o111);
  await assertLocalLinks(path.join(install, "node_modules/viaferrata"), names);

  const executable = path.join(install, "node_modules/.bin/vf");
  const version = await packageVersion();
  assert.equal(command(executable, ["--version"], temp).trim(), version);
  const help = command(executable, ["--help"], temp);
  assert.match(help, /init/);
  for (const resource of ["instructions/workflow.md", "templates/README.md"]) {
    assert(help.includes(path.join(packageRoot, resource)));
  }

  return executable;
}
