import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { parseDocument, isScalar } from "yaml";

import { repo, temporary, write, snapshot, execute } from "./helpers.ts";

const configurations = ["oxlint.config.mts", "oxfmt.config.mts", ".markdownlint-cli2.mjs"];

async function qualityProject(t: Parameters<typeof temporary>[0]) {
  const root = await temporary(t);
  for (const name of [...configurations, "tsconfig.json", "package.json"]) {
    await fs.copyFile(path.join(repo, name), path.join(root, name));
  }
  await fs.symlink(path.join(repo, "node_modules"), path.join(root, "node_modules"), "dir");
  return root;
}

function tool(root: string, name: string, ...args: string[]) {
  return execute(path.join(repo, "node_modules/.bin", name), args, {
    cwd: root,
    timeout: 30000,
  });
}

function templateContract(source: string) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(source);
  assert(match);
  const yaml = parseDocument(match[1]);
  assert.deepEqual(yaml.errors, []);
  for (const key of ["created", "updated"]) {
    const node: unknown = yaml.get(key, true);
    assert(isScalar(node) && (node.type === "QUOTE_DOUBLE" || node.type === "QUOTE_SINGLE"));
  }
  const fields: unknown = yaml.toJS();
  return {
    fields,
    parameters: [...source.matchAll(/\{\{[^{}]+\}\}/g)].map((m) => m[0]),
    comments: [...source.matchAll(/<!--[\s\S]*?-->/g)].map((m) => m[0]),
    yamlComments: match[1].split("\n").filter((line) => /^\s*#/.test(line)),
    headings: source.split("\n").filter((line) => /^#{1,6} /.test(line)),
    references: [...source.matchAll(/\[(?:change|srs|research|adr)-[^\]]*\]/g)].map((m) => m[0]),
  };
}

void test("formatter preserves all seven template contracts and is idempotent", async (t) => {
  const root = await qualityProject(t);
  const contracts = new Map<string, ReturnType<typeof templateContract>>();
  for (const name of ["intent", "spec", "plan", "journal", "srs", "research", "adr"]) {
    const file = `templates/${name}.md`;
    const source = await fs.readFile(path.join(repo, file), "utf8");
    contracts.set(file, templateContract(source));
    await write(root, file, source);
  }
  const formatted = tool(root, "oxfmt", "templates");
  assert.equal(formatted.status, 0, formatted.text);
  for (const [file, contract] of contracts) {
    assert.deepEqual(
      templateContract(await fs.readFile(path.join(root, file), "utf8")),
      contract,
      file,
    );
  }
  const before = await snapshot(root);
  const again = tool(root, "oxfmt", "templates");
  assert.equal(again.status, 0, again.text);
  const after = await snapshot(root);
  // Formatting may touch mtime; idempotence concerns exact bytes and modes.
  for (const file of contracts.keys()) {
    assert.equal(after[file].content, before[file].content);
  }
});

void test("quality checks detect violations without writes and honor exclusions", async (t) => {
  const root = await qualityProject(t);
  for (const directory of ["bin", "src", "scripts"]) {
    await write(
      root,
      `${directory}/probe.ts`,
      "export {};\nconst count = 1; count = 2;\nPromise.resolve(1);\n",
    );
  }
  await write(root, "README.md", "# Probe\n\n### Skipped heading\n");
  for (const change of ["change-000001", "change-000002"]) {
    await write(
      root,
      `viaferrata/changes/${change}/history.md`,
      "# History\n\n### Skipped heading\n",
    );
  }
  const ignored = ["dist", ".viaferrata", "src/tests/fixtures"];
  for (const directory of ignored) {
    await write(root, `${directory}/ignored.ts`, "this is not valid TypeScript {{\n");
    await write(root, `${directory}/ignored.md`, "# Heading\n\n### Skipped\n");
  }
  const before = await snapshot(root);
  const lint = tool(root, "oxlint", "--deny-warnings", "bin", "src", "scripts");
  assert.equal(lint.status, 1, lint.text);
  assert.match(lint.text, /no-const-assign/);
  assert.match(lint.text, /no-floating-promises/);
  for (const directory of ["bin", "src", "scripts"]) {
    assert(lint.text.includes(`${directory}/probe.ts`), lint.text);
  }
  assert(!lint.text.includes("ignored.ts"), lint.text);
  const markdown = tool(root, "markdownlint-cli2");
  assert.equal(markdown.status, 1, markdown.text);
  assert.match(markdown.text, /MD001/);
  for (const change of ["change-000001", "change-000002"]) {
    assert(markdown.text.includes(`${change}/history.md`), markdown.text);
  }
  assert(!markdown.text.includes("ignored.md:"), markdown.text);
  const format = tool(root, "oxfmt", "--check", ".");
  assert.equal(format.status, 1, format.text);
  assert(!format.text.includes("ignored.ts"), format.text);
  assert.deepEqual(await snapshot(root), before);
  const fixed = tool(root, "oxfmt", ".");
  assert.equal(fixed.status, 0, fixed.text);
  const after = await snapshot(root);
  for (const directory of ignored) {
    for (const name of ["ignored.ts", "ignored.md"]) {
      assert.deepEqual(after[`${directory}/${name}`], before[`${directory}/${name}`]);
    }
  }
});
