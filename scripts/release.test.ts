import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { execute, repo, temporary, write } from "../src/tests/helpers.ts";

async function setup(t: Parameters<typeof temporary>[0]) {
  const root = await temporary(t);
  await write(
    root,
    "npm",
    `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));\nprocess.exit(Number(process.env.FAKE_NPM_EXIT ?? 0));\n`,
  );
  await fs.chmod(path.join(root, "npm"), 0o755);
  await write(root, "package.tgz", "test archive");
  return root;
}

function run(root: string, args: string[], env = {}) {
  return execute(process.execPath, [path.join(repo, "scripts/release.ts"), ...args], {
    cwd: root,
    env: { ...process.env, PATH: root, ...env },
  });
}

void test("release rejects invalid input before invoking npm", async (t) => {
  const root = await setup(t);
  await fs.mkdir(path.join(root, "directory.tgz"));
  await write(root, "package.txt", "not an archive");
  for (const args of [
    [],
    ["unknown", "package.tgz"],
    ["publish"],
    ["dry-run", " "],
    ["publish", "package.tgz", "--access", "public"],
    ["publish", "missing.tgz"],
    ["publish", "directory.tgz"],
    ["publish", "package.txt"],
  ]) {
    const result = run(root, args);
    assert.equal(result.status, 1, JSON.stringify(args));
    assert.equal(result.stdout, "", "npm must not run");
    assert.notEqual(result.stderr, "");
  }
});

void test("release passes an absolute archive path without shell interpretation", async (t) => {
  const root = await setup(t);
  const archive = "--archive $(touch EXECUTED) `touch EXECUTED`.tgz";
  await write(root, archive, "test archive");
  for (const mode of ["dry-run", "publish"]) {
    const result = run(root, [mode, archive]);
    assert.equal(result.status, 0, result.text);
    assert.deepEqual(JSON.parse(result.stdout), [
      "publish",
      path.join(root, archive),
      "--tag",
      "latest",
      "--registry",
      "https://registry.npmjs.org",
      ...(mode === "dry-run" ? ["--dry-run"] : []),
    ]);
  }
  await assert.rejects(fs.access(path.join(root, "EXECUTED")));
});

void test("release reports npm failures and missing executable", async (t) => {
  const root = await setup(t);
  assert.equal(run(root, ["publish", "package.tgz"], { FAKE_NPM_EXIT: "7" }).status, 7);
  const missing = run(root, ["dry-run", "package.tgz"], { PATH: path.join(root, "no-bin") });
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /ENOENT/);
});
