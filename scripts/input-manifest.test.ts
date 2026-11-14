import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { temporary, write } from "../src/tests/helpers.ts";
import { inputManifest } from "./input-manifest.ts";

void test("manifest records exact bytes, new files and deterministic path order", async (t) => {
  const root = await temporary(t);
  for (const directory of ["bin", "src", "templates", "instructions", "scripts"]) {
    await fs.mkdir(path.join(root, directory));
  }
  for (const file of [
    "package.json",
    "package-lock.json",
    "viaferrata.toml",
    "README.md",
    "LICENSE",
    "tsconfig.json",
    "tsconfig.build.json",
    "oxlint.config.mts",
    "oxfmt.config.mts",
    ".markdownlint-cli2.mjs",
  ]) {
    await write(root, file, "");
  }
  await write(root, "src/Z.ts", "a\n");
  await write(root, "src/a.ts", "b\n");
  const first = await inputManifest(root);
  assert.deepEqual(
    first.files.map((file) => file.path),
    [
      ".markdownlint-cli2.mjs",
      "LICENSE",
      "README.md",
      "oxfmt.config.mts",
      "oxlint.config.mts",
      "package-lock.json",
      "package.json",
      "src/Z.ts",
      "src/a.ts",
      "tsconfig.build.json",
      "tsconfig.json",
      "viaferrata.toml",
    ],
  );
  assert.equal(
    first.files[0].sha256,
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
  assert.deepEqual(await inputManifest(root), first);
  const hash = createHash("sha256");
  for (const file of first.files) {
    hash.update(file.path);
    hash.update(Buffer.from([0]));
    hash.update(file.sha256);
    hash.update("\n");
  }
  assert.equal(first.aggregate, hash.digest("hex"));
  await write(root, "src/a.ts", "  b\r\n");
  const formatted = await inputManifest(root);
  assert.notEqual(formatted.aggregate, first.aggregate);
  assert.deepEqual(
    formatted.files
      .filter((file, i) => file.sha256 !== first.files[i].sha256)
      .map((file) => file.path),
    ["src/a.ts"],
  );
  await write(root, "src/new.ts", "");
  const added = await inputManifest(root);
  assert.equal(added.files.length, first.files.length + 1);
  assert.notEqual(added.aggregate, formatted.aggregate);
  for (const name of [
    "tsconfig.json",
    "tsconfig.build.json",
    "oxlint.config.mts",
    "oxfmt.config.mts",
    ".markdownlint-cli2.mjs",
  ]) {
    const before = await inputManifest(root);
    await write(root, name, '{"compilerOptions": {"strict": true}}');
    assert.notEqual((await inputManifest(root)).aggregate, before.aggregate);
  }
  const configured = await inputManifest(root);
  await write(root, "dist/src/cli.js", "generated output");
  await write(root, "evidence/result.json", "historical result");
  await write(root, "viaferrata/changes/change-000001/journal.md", "updated result");
  assert.deepEqual(await inputManifest(root), configured);
});
