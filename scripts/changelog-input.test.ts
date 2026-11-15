import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { execute, repo, snapshot, temporary, write } from "../src/tests/helpers.ts";
import { changelogInput } from "./changelog-input.ts";

function git(root: string, ...args: string[]) {
  const result = execute("git", args, { cwd: root });
  assert.equal(result.status, 0, result.text);
  return result.stdout.trim();
}
async function setup(t: Parameters<typeof temporary>[0]) {
  const root = await temporary(t);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Test");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "commit.gpgsign", "false");
  await write(root, "package.json", '{"version":"0.1.0"}');
  git(root, "add", ".");
  git(root, "commit", "-m", "feat: initial");
  return root;
}
async function commit(root: string, file: string, message = "feat: next") {
  await write(root, file, message);
  git(root, "add", ".");
  git(root, "commit", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

void test("initial history preserves full messages and unusual paths without writes", async (t) => {
  const root = await setup(t);
  const message =
    "feat: shell $(touch EXECUTED) `touch EXECUTED`\n\nBody with details\n\nBREAKING CHANGE: detail";
  await commit(root, "path with spaces\nand newline.txt", message);
  const before = await snapshot(root);
  const result = await changelogInput(root, []);
  assert.equal(result.version, "0.1.0");
  assert.equal(result.from, null);
  assert.deepEqual(
    result.commits.map((c) => c.sha),
    git(root, "log", "--reverse", "--format=%H").split("\n"),
  );
  assert.deepEqual(result.commits[0].paths, ["package.json"]);
  assert.equal(result.commits[1].message.trimEnd(), message);
  assert.deepEqual(result.commits[1].paths, ["path with spaces\nand newline.txt"]);
  assert.deepEqual(await snapshot(root), before);
});

void test("nearest ancestor tag, current-version tag, explicit bounds, initial and empty range", async (t) => {
  const root = await setup(t);
  git(root, "tag", "v0.0.1");
  await commit(root, "first.txt");
  git(root, "tag", "-a", "v0.0.2", "-m", "release");
  const upper = await commit(root, "second.txt");
  git(root, "tag", "v0.1.0");
  const result = await changelogInput(root, []);
  assert.equal(result.tag, "v0.0.2");
  assert.deepEqual(
    result.commits.map((c) => c.sha),
    [upper],
  );
  assert.deepEqual(
    result.commits[0].paths,
    git(root, "diff", "--name-only", "v0.0.2", "HEAD").split("\n"),
  );
  assert.equal((await changelogInput(root, ["--initial"])).commits.length, 3);
  const explicit = await changelogInput(root, ["--from", "v0.0.1", "--to", "v0.0.2"]);
  assert.equal(explicit.commits.length, 1);
  assert.equal(explicit.to.sha, git(root, "rev-parse", "v0.0.2^{commit}"));
  assert.equal((await changelogInput(root, ["--from", "HEAD"])).commits.length, 0);
});

void test("ambiguous tags and merged branches require an explicit boundary", async (t) => {
  const root = await setup(t);
  git(root, "tag", "v0.0.1");
  git(root, "tag", "v0.0.2");
  await assert.rejects(changelogInput(root, []), /Неоднозначная граница/);
  assert.equal((await changelogInput(root, ["--from", "v0.0.1"])).commits.length, 0);
  git(root, "checkout", "-b", "side");
  await commit(root, "side.txt");
  git(root, "tag", "v0.0.3");
  git(root, "checkout", "main");
  await commit(root, "main.txt");
  git(root, "tag", "v0.0.4");
  git(root, "merge", "--no-ff", "side", "-m", "merge side");
  await assert.rejects(changelogInput(root, []), /Неоднозначная граница/);
  const result = await changelogInput(root, ["--from", "v0.0.4"]);
  assert.equal(result.commits.length, 2);
  assert.deepEqual(new Set(result.commits[1].paths), new Set(["side.txt", "main.txt"]));
  await assert.rejects(
    changelogInput(root, ["--from", "v0.0.4", "--to", "side"]),
    /не является предком/,
  );
});

void test("invalid arguments, revisions, missing Git and shallow history fail explicitly", async (t) => {
  const root = await setup(t);
  for (const args of [
    ["--from"],
    ["--to", "--all"],
    ["--wat"],
    ["--initial", "--from", "HEAD"],
    ["--initial", "--initial"],
    ["--from", "missing"],
    ["--to", "$(touch EXECUTED)"],
  ]) {
    await assert.rejects(changelogInput(root, args));
  }
  await assert.rejects(fs.access(path.join(root, "EXECUTED")));
  const script = path.join(repo, "scripts/changelog-input.ts");
  const absent = execute(process.execPath, [script], {
    cwd: root,
    env: { ...process.env, PATH: "" },
  });
  assert.equal(absent.status, 1);
  assert.match(absent.stderr, /Не удалось запустить Git/);
  await commit(root, "second.txt");
  const clone = path.join(await temporary(t), "shallow");
  git(root, "clone", "--depth=1", `file://${root}`, clone);
  for (const args of [[], ["--initial"], ["--from", "HEAD"]]) {
    await assert.rejects(changelogInput(clone, args), /Неполная история/);
  }
  const invalid = execute(process.execPath, [script, "--to", "missing"], { cwd: root });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, "");
  assert.match(invalid.stderr, /Ошибка Git/);
});
