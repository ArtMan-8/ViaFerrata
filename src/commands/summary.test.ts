import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { stringify } from "yaml";

import { cli, execute, project, run, snapshot, temporary, write } from "../tests/helpers.ts";

const check = {
  subject: "Установка",
  outcome: "passed",
  source: "CI 42",
  revision: "рабочее дерево на базе abc",
};
const checks = [
  check,
  { ...check, subject: "Сборка", revision: "def" },
  { ...check, outcome: "failed", revision: null, executor: null },
];

void test("stdin accepts YAML and JSON without a project and never emits partial output", async (t) => {
  const cwd = await temporary(t);
  const invoke = (input: string) =>
    execute(process.execPath, [cli, "summary", "--stdin"], { cwd, input });
  const result = invoke(stringify({ checks }));
  assert.equal(result.status, 0, result.text);
  assert.equal(result.stdout, invoke(JSON.stringify({ checks })).stdout);
  assert.match(
    result.stdout,
    /Установка — passed[\s\S]*рабочее дерево на базе abc[\s\S]*Сборка — passed[\s\S]*def[\s\S]*Установка — failed/,
  );
  assert.match(result.stdout, /редакция неизвестна/);
  assert.match(result.stdout, /Исполнитель: неизвестен/);
  assert.match(result.stdout, /согласования не указано/);
  assert.match(invoke("checks: []").stdout, /Записанных проверок: 0/);
  const empty = invoke("  \n");
  assert.equal(empty.status, 2);
  assert.match(empty.stderr, /E_CLI_COMMAND_USAGE: Пустой stdin/);
  for (const input of [
    "{}",
    "checks: {}",
    stringify({ checks }) + "    outcome: failed\n",
    stringify({ checks: [{ ...check, revision: 42 }] }),
  ]) {
    const error = invoke(input);
    assert.notEqual(error.status, 0);
    assert.equal(error.stdout, "");
    assert.match(error.stderr, /stdin/);
  }
  assert.deepEqual(await fs.readdir(cwd), []);
});

void test("summary reads only the selected Journal sections and detects conflicting locations", async (t) => {
  const root = await project(t, false);
  const change = "change-000042";
  const working = path.join(root, "viaferrata", "changes", change);
  const archive = path.join(root, "viaferrata", "archive", "changes", change);
  const file = "journal.md";
  const invoke = () => run(["summary", change], root);
  const fence = (data: string) => "```yaml\n" + data + "\n```\n";
  const head =
    "---\nid: change-000042/journal\n---\n## Significant Events\n" +
    fence("decisions: [Разрешена установка по переписке]") +
    "\n## Verification and Result\n### Verification\n";
  const old = head + "Исторический результат: passed.\n### Result\n" + fence("checks: []");
  await fs.mkdir(working, { recursive: true });
  const missing = invoke();
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /journal\.md:1:1 E_DOCUMENT_NOT_FOUND/);
  await write(working, file, head.replace("/journal", "/spec"));
  assert.match(invoke().stderr, /E_LOCATION: \[document-location\]/);
  await write(working, file, old);
  assert.match(invoke().stderr, /Формат сводки не найден/);
  await write(working, file, head + fence("checks: []"));
  assert.match(invoke().stdout, /проверок: 0[\s\S]*Разрешена установка/);
  const records = fence(stringify({ checks }));
  await write(working, file, head + records + records);
  const duplicateLine = (head + records).split("\n").length;
  assert(invoke().stderr.includes(`journal.md:${duplicateLine}:1 E_FIELD: Несколько блоков`));
  await write(working, file, head + fence(stringify({ checks }) + "    outcome: failed"));
  const bad = invoke();
  assert.notEqual(bad.status, 0);
  assert.equal(bad.stdout, "");
  await write(working, file, head + records + "### Result\nРучной текст\n" + fence("checks: []"));
  const before = await snapshot(root);
  const result = invoke();
  assert.equal(result.status, 0, result.text);
  assert.match(result.stdout, /проверок: 3[\s\S]*Разрешена установка/);
  assert.deepEqual(await snapshot(root), before);
  await fs.mkdir(path.dirname(archive), { recursive: true });
  await fs.rename(working, archive);
  assert.match(invoke().stdout, /архив/);
  await fs.mkdir(working);
  assert.match(invoke().stderr, /Конфликт/);
});

void test("Journal keeps Markdown scalar endings and ignores YAML examples outside the selected headings", async (t) => {
  const root = await project(t, false);
  const journal = [
    "---",
    "id: change-000042/journal",
    "---",
    "## Significant Events",
    "### Решение",
    "  ~~~yaml",
    "  decisions:",
    "    - |+",
    "      Текст решения",
    "",
    "  ~~~",
    "## Verification and Result",
    "### Verification",
    "#### V-1: Проверка",
    "~~~yaml",
    "checks: []",
    "~~~",
    "### Result",
    "> ```yaml",
    "> broken: [",
    "> ```",
    "```yaml",
    "broken: [",
    "```",
  ].join("\r\n");
  await write(root, "viaferrata/changes/change-000042/journal.md", journal);
  const result = run(["summary", "change-000042"], root);
  assert.equal(result.status, 0, result.text);
  assert.equal(
    result.stdout,
    "change-000042\nЗаписанных проверок: 0\nОснования согласования:\nТекст решения\n\n",
  );
});
