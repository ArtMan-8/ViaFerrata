import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test, { type TestContext } from "node:test";

import { temporary, write, run } from "../tests/helpers.ts";

const id = "change-000042";
const directory = `docs/changes/${id}`;
const sorted = ["src/deep/**", "src/Flat/*", "src/feature.*", "README.md", "readme.md"];

async function fixture(t: TestContext, profile = "lite") {
  const root = await temporary(t);
  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", ...args],
      { cwd: root, encoding: "utf8" },
    ).trim();
  await write(root, "viaferrata.toml", `profile = "${profile}"\ndocuments_root = "docs"\n`);
  await write(root, ".gitignore", "*.ignored\n");
  await write(root, "outside", "old");
  await write(root, "src/feature.ts", "old");
  await write(root, "tracked.ignored", "old");
  git("init", "-q");
  git("add", ".");
  git("add", "-f", "tracked.ignored");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  const cli = (...args: string[]) => run(["scope", id, ...args], root);
  const spec = (masks?: string[]) =>
    write(
      root,
      directory + "/spec.md",
      `---\nid: "${id}/spec"\n${masks ? "scope: " + JSON.stringify(masks) + "\n" : ""}---\n`,
    );
  const record = (digest: string, revision = base) =>
    `scope_check:\n  base: "${revision}"\n  digest: "${digest}"`;
  const journal = (fields: string) =>
    write(
      root,
      directory + "/journal.md",
      `---\nid: "${id}/journal"\n---\n\n## Significant Events\n\n\`\`\`yaml\n${fields}\n\`\`\`\n`,
    );
  const approve = (digest: string, revision = base) =>
    journal(`decisions: ["Принята указанная область."]\n${record(digest, revision)}`);
  await spec(sorted);
  const digest = cli("--digest");
  assert.equal(digest.status, 0, digest.text);
  await approve(digest.stdout.trim());
  return { root, git, base, cli, spec, record, journal, approve, digest: digest.stdout.trim() };
}

void test("scope uses one tree order for hashing and requires an explicit accepted delta", async (t) => {
  const { root, cli, spec, record, journal, approve, digest } = await fixture(t, "strict");
  assert.equal(digest, createHash("sha256").update(JSON.stringify(sorted)).digest("hex"));
  await spec(sorted.toReversed());
  const before = await fs.readFile(path.join(root, directory, "spec.md"));
  assert.equal(cli("--digest").stdout.trim(), digest);
  assert.equal(cli().status, 0);
  assert.deepEqual(await fs.readFile(path.join(root, directory, "spec.md")), before);
  await spec([...sorted, "extra.*"]);
  await write(root, "extra.ts", "new");
  assert.match(cli().stderr, /Сумма scope/);
  const updated = cli("--digest").stdout.trim();
  await approve(updated);
  assert.equal(cli().status, 0);
  await journal(record(updated));
  assert.match(cli().stderr, /decisions/);
  await journal(`decisions: ["ok"]\n${record(updated)}\n${record(updated)}`);
  assert.match(cli().stderr, /E_YAML/);
  await approve(updated, "1".repeat(40));
  assert.match(cli().stderr, /E_IO/);
  for (const mask of ["/absolute", "C:/abs", "../up", "a//b", "x/**/y", "src/[ab]", "a\\b"]) {
    await spec([mask]);
    assert.match(cli("--digest").stderr, /маска scope/);
  }
  await spec();
  assert.equal(cli("--digest").stdout.trim(), createHash("sha256").update("[]").digest("hex"));
});

void test("scope names every Git layer, including opposite edits and both rename directions", async (t) => {
  const { root, cli, git } = await fixture(t);
  await write(root, "src/feature.test.ts", "test");
  await write(root, "src/deep/nested/.dot", "ok");
  await write(root, "src/Flat/.new", "ok");
  await write(root, "untracked.ignored", "ignored");
  const ok = cli();
  assert.equal(ok.status, 0, ok.text);
  await write(root, "outside", "changed");
  git("add", "outside");
  await write(root, "outside", "old");
  let out = cli();
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /staged: "outside"/);
  assert.match(out.stderr, /unstaged: "outside"/);
  git("commit", "-qm", "staged change");
  assert.match(cli().stderr, /base → HEAD: "outside"/);
  git("mv", "outside", "src/feature.moved");
  git("mv", "src/feature.ts", "other-end");
  await write(root, "tracked.ignored", "changed");
  for (const name of [
    "src/Feature.ts",
    "src/Flat/nested/new",
    "src/sibling.ts",
    "a b\nc",
    directory + "/notes.md",
    "docs/changes/change-000043/spec.md",
  ]) {
    await write(root, name, "new");
  }
  out = cli();
  for (const name of [
    "src/Feature.ts",
    "src/Flat/nested/new",
    "src/sibling.ts",
    "a b\nc",
    directory + "/notes.md",
    "docs/changes/change-000043/spec.md",
  ]) {
    assert(out.stderr.includes("untracked: " + JSON.stringify(name)), out.text);
  }
  assert.match(out.stderr, /staged: "outside"/);
  assert.match(out.stderr, /staged: "other-end"/);
  assert.match(out.stderr, /unstaged: "tracked.ignored"/);
  assert(!out.stderr.includes("untracked.ignored"));
});

void test("scope rejects unsupported object types, conflicts and an unrelated base", async (t) => {
  const { root, cli, git, base, approve, digest } = await fixture(t);
  await fs.symlink("missing", path.join(root, "src/feature.link"));
  assert.match(cli().stderr, /untracked: "src\/feature.link" — неподдерживаемый/);
  git("add", "src/feature.link");
  assert.match(cli().stderr, /staged: "src\/feature.link" — неподдерживаемый/);
  await fs.rm(path.join(root, "src/feature.link"));
  await write(root, "src/feature.link", "regular");
  assert.match(cli().stderr, /unstaged: "src\/feature.link" — неподдерживаемый/);
  git("update-index", "--add", "--cacheinfo", `160000,${base},src/feature.module`);
  assert.match(cli().stderr, /staged: "src\/feature.module" — неподдерживаемый/);
  const blob = git("rev-parse", "HEAD:outside");
  execFileSync("git", ["update-index", "--index-info"], {
    cwd: root,
    input: `100644 ${blob} 1\tconflict\n100644 ${blob} 2\tconflict\n`,
  });
  assert.match(cli().stderr, /staged: "conflict" — неподдерживаемый/);
  const unrelated = git("commit-tree", git("rev-parse", "HEAD^{tree}"), "-m", "unrelated");
  await approve(digest, unrelated);
  assert.match(cli().stderr, /E_IO/);
});
