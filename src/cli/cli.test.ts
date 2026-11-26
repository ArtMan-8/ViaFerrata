import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../config.ts";
import { CommandError } from "../diagnostics.ts";
import {
  project,
  temporary,
  run,
  write,
  edit,
  snapshot,
  packageVersion,
} from "../tests/helpers.ts";

void test("help/version and usage work without a project", async (t) => {
  const root = await temporary(t);
  assert.equal(run([], root).status, 0);
  assert.match(run(["--help"], root).text, /vf.*validate/);
  assert.equal(run(["--version"], root).stdout.trim(), await packageVersion());
  for (const args of [
    ["unknown"],
    ["validate", "extra"],
    ["--root"],
    ["--unknown"],
    ["new", "change", ""],
    ["new", "change", "a\nb"],
    ["--root", root, "--root", root, "validate"],
  ]) {
    const result = run(args, root);
    assert.equal(result.status, 2, result.text);
    assert.match(
      result.text,
      args[0] === "validate" || args[0] === "new" ? /E_CLI_COMMAND_USAGE/ : /E_CLI_SYNTAX/,
    );
  }
});

void test("new and validate discover the nearest project and never skip invalid config", async (t) => {
  const root = await project(t, false);
  const child = path.join(root, "child with spaces", "deeper");
  await fs.mkdir(child, { recursive: true });
  assert.equal(run(["validate"], child).status, 0);
  assert.equal(run(["new", "change", "Задача"], child).status, 0);
  assert((await fs.stat(path.join(root, "viaferrata/changes/change-000001/intent.md"))).isFile());
  const before = await snapshot(path.join(root, "viaferrata"));
  await write(path.dirname(child), "viaferrata.toml", "profile = [");
  for (const args of [["validate"], ["new", "change", "Отказ"]]) {
    const result = run(args, child);
    assert.equal(result.status, 2, result.text);
    assert.match(result.text, /E_CONFIG/);
  }
  assert.deepEqual(await snapshot(path.join(root, "viaferrata")), before);
  await write(path.dirname(child), "viaferrata.toml", 'profile = "strict"\n');
  const result = run(["validate"], child);
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /Профиль: strict/);
});

void test("max + 1 preserves occupied files and incomplete directories", async (t) => {
  const root = await project(t, false);
  await write(root, "viaferrata/changes/change-000007", "user-owned");
  await fs.mkdir(path.join(root, "viaferrata/changes/change-000010"));
  const result = run(["new", "change", "Следующая"], root);
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /change-000011/);
  assert.equal(
    await fs.readFile(path.join(root, "viaferrata/changes/change-000007"), "utf8"),
    "user-owned",
  );
  assert.deepEqual(await fs.readdir(path.join(root, "viaferrata/changes/change-000010")), []);
  // Existing TODO drafts do not block the lightweight allocation index.
  assert.match(run(["new", "change", "Ещё одна"], root).text, /change-000012/);
});

void test("invalid allocation index and exhausted IDs stop before writing", async (t) => {
  const root = await project(t);
  await edit(root, "viaferrata/changes/change-000042/intent.md", (s) =>
    s.replace("id: change-000042/intent", "id: wrong"),
  );
  const before = await snapshot(root);
  const result = run(["new", "change", "Задача"], root);
  assert.equal(result.status, 1);
  assert.match(result.text, /E_ID/);
  assert.deepEqual(await snapshot(root), before);
  const full = await project(t, false);
  await write(full, "viaferrata/changes/change-999999", "occupied");
  const exhausted = run(["new", "change", "Задача"], full);
  assert.equal(exhausted.status, 2);
  assert.match(exhausted.text, /E_ID_EXHAUSTED/);
});

for (const [name, config, expected] of [
  ["malformed TOML", "profile = [", "E_CONFIG"],
  ["unknown key", 'profile = "lite"\nunknown = true\n', "E_CONFIG"],
  ["duplicate key", 'profile = "lite"\nprofile = "strict"\n', "E_CONFIG"],
  ["bad profile", 'profile = "disabled"', "E_CONFIG"],
  ["wrong type", 'profile = "lite"\ndocuments_root = []', "E_CONFIG"],
  ["parent escape", 'profile = "lite"\ndocuments_root = "../other"', "E_CONFIG"],
  ["absolute root", 'profile = "lite"\ndocuments_root = "/tmp"', "E_CONFIG"],
  ["temporary root", 'profile = "lite"\ndocuments_root = ".viaferrata"', "E_CONFIG"],
  ["required checks", 'profile = "lite"\nrequired_checks = ["unit"]', "E_CONFIG"],
]) {
  void test(`config: ${name} stops new before writing`, async (t) => {
    const root = await project(t, false);
    await fs.writeFile(path.join(root, "viaferrata.toml"), config);
    const before = await snapshot(root);
    const result = run(["new", "change", "No write"], root);
    assert.equal(result.status, 2, result.text);
    assert(result.text.includes(expected), result.text);
    assert.deepEqual(await snapshot(root), before);
  });
}

void test("missing config, symlinked root/config/document directory and empty project", async (t) => {
  const missing = await temporary(t);
  assert.match(run(["validate"], missing).text, /E_CONFIG/);
  const root = await project(t, false);
  const empty = run(["validate"], root);
  assert.equal(empty.status, 0);
  assert.match(empty.text, /Документов нет/);
  await fs.symlink(root, path.join(missing, "link"));
  await assert.rejects(
    loadConfig(path.join(missing, "link")),
    (error) => error instanceof CommandError && error.code === "E_UNSUPPORTED",
  );
  await fs.symlink(root, path.join(root, "viaferrata"));
  assert.match(run(["new", "change", "No write"], root).text, /E_UNSUPPORTED/);
  const other = await temporary(t);
  await fs.symlink(path.join(root, "viaferrata.toml"), path.join(other, "viaferrata.toml"));
  assert.match(run(["validate"], other).text, /E_UNSUPPORTED/);
});
for (const [occupied, next] of [
  ["009999", "010000"],
  ["099999", "100000"],
  ["999998", "999999"],
]) {
  void test(`new advances ${occupied} to ${next} within the six-digit range`, async (t) => {
    const root = await project(t, false);
    await write(root, `viaferrata/changes/change-${occupied}`, "reserved");
    const result = run(["new", "change", "Граница диапазона"], root);
    assert.equal(result.status, 0, result.text);
    const intent = await fs.readFile(
      path.join(root, `viaferrata/changes/change-${next}/intent.md`),
      "utf8",
    );
    assert(intent.includes(`id: "change-${next}/intent"`));
    const checked = run(["validate"], root);
    assert.equal(checked.status, 1, checked.text);
    assert.match(checked.text, /E_DRAFT_PLACEHOLDER/);
    assert(!/\bE_ID\b/.test(checked.text), checked.text);
    if (next === "999999") {
      const exhausted = run(["new", "change", "За пределами диапазона"], root);
      assert.equal(exhausted.status, 2, exhausted.text);
      assert.match(exhausted.text, /E_ID_EXHAUSTED/);
    }
  });
}

void test("invalid new syntax preserves the project and shows the new command syntax", async (t) => {
  const root = await project(t);
  const before = await snapshot(root);
  for (const args of [
    [],
    ["unknown", "Title"],
    ["adr"],
    ["srs", ""],
    ["research", "two", "titles"],
    ["change", "a\nb"],
    ["srs", "--invalid"],
  ]) {
    const result = run(["new", ...args], root);
    assert.equal(result.status, 2, result.text);
    assert.match(result.stderr, /E_CLI_COMMAND_USAGE.*vf new/);
    assert.deepEqual(await snapshot(root), before);
  }
});

void test("commands preserve the same source diagnostic for a malformed Journal", async (t) => {
  const root = await project(t);
  const change = "change-000042";
  const file = `viaferrata/changes/${change}/journal.md`;
  await write(root, file, "---\nid: [\n---\n# Journal\n");
  const validation = run(["validate"], root);
  assert.equal(validation.status, 1);
  const header = validation.stderr
    .split("\n")
    .find((line) => line.includes("E_YAML: [valid-yaml]"));
  assert.ok(header, validation.stderr);
  assert(header.startsWith(`${file}:2:6 E_YAML:`), header);
  for (const command of ["summary", "scope", "complete"]) {
    const result = run([command, change], root);
    assert.equal(result.status, 2);
    assert(result.stderr.split("\n").includes(header), result.stderr);
  }
});

void test("commands report the same missing change without changing files", async (t) => {
  const root = await project(t);
  const before = await snapshot(root);
  for (const command of ["summary", "scope", "complete"]) {
    const result = run([command, "change-999999"], root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /E_DOCUMENT_NOT_FOUND/);
  }
  assert.deepEqual(await snapshot(root), before);
});
