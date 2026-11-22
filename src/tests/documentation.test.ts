import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { errorCode } from "../diagnostics.ts";
import { coreRules, strictRules } from "../rules.ts";
import { assertLocalLinks } from "./document-links.ts";
import { repo } from "./helpers.ts";

void test("repository documentation links resolve within this repository", async () => {
  const files = ["README.md", "AGENTS.md", "CHANGELOG.md"];
  async function walk(relative: string) {
    let entries;
    try {
      entries = await fs.readdir(path.join(repo, relative), {
        withFileTypes: true,
      });
    } catch (error) {
      if (relative === "docs" && errorCode(error) === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const file = `${relative}/${entry.name}`;
      if (entry.isDirectory()) {
        await walk(file);
      } else if (entry.isFile()) {
        files.push(file);
      }
    }
  }
  for (const directory of ["docs", "instructions", "templates", "viaferrata"]) {
    await walk(directory);
  }
  await assertLocalLinks(repo, files);
});

void test("rule catalogue lists each public rule once", async () => {
  const text = await fs.readFile(path.join(repo, "viaferrata/specs/built-in-checks.md"), "utf8");
  function checkCatalogue(markdown: string) {
    const rows = markdown
      .split("\n")
      .filter((line) => /^\|\s*`/.test(line))
      .map((line) => {
        const cells = line.split("|");
        return [cells[1].trim(), cells.at(-2)?.trim() ?? ""];
      });
    const rules = [...coreRules, ...strictRules];
    assert.equal(
      new Set(rules.map((rule) => rule.id)).size,
      rules.length,
      "duplicate rule definition",
    );
    const expected = rules.map((rule) => [`\`${rule.id}\``, rule.code]);
    const byId = (a: string[], b: string[]) => a[0].localeCompare(b[0]);
    assert.deepEqual(rows.sort(byId), expected.sort(byId));
  }
  checkCatalogue(text);
  const row = text.split("\n").find((line) => /^\|\s*`supported-profile`/.test(line));
  assert.ok(row);
  assert.throws(() => checkCatalogue(text.replace(row, "")), assert.AssertionError);
  assert.throws(() => checkCatalogue(text + "\n" + row), assert.AssertionError);
  assert.throws(() => checkCatalogue(text + "\n| `unknown-rule` |"), assert.AssertionError);
});
