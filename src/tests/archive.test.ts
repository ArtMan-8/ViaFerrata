import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { createChange } from "../commands/new.ts";
import { validateProject } from "../commands/validate.ts";
import { loadConfig } from "../config.ts";
import { exitCode } from "../diagnostics.ts";
import { project, write, snapshot, edit } from "./helpers.ts";

function document(id: string, body: string, fields = "status: approved\n") {
  return `---\nid: ${id}\n${fields}created: "2026-11-21"\nupdated: "2026-11-21"\n---\n# Экспорт\n\n${body}\n`;
}
const srs =
  "## Purpose and Boundaries\nЭкспорт записей пользователем.\n\n## System Overview\nЭкспорт возвращает файл с выбранными записями.\n\n## Requirements\n\n### R-2: JSON\nЭкспорт должен поддерживать JSON.\n\n## Verification\nРазобрать файл JSON и сравнить записи.\n";
function delta(
  operation: string,
  target = "srs-000001/R-1",
  before = "CSV с запятой.",
  after = "CSV с точкой с запятой.",
) {
  return `## Requirements\n\n### R-1: CSV\n\n- Operation: ${operation}\n- Changes:\n  - [${target}]\n${operation !== "add" ? `- Before: ${before}\n` : ""}${operation !== "remove" ? `- After: ${after}\n` : ""}`;
}
async function bundle(root: string, location: string, execution: string, body: string) {
  const id = location.split("/").at(-1)!;
  await write(root, `${location}/intent.md`, document(`${id}/intent`, "## Goal\nЭкспорт."));
  await write(root, `${location}/spec.md`, document(`${id}/spec`, body));
  await write(
    root,
    `${location}/plan.md`,
    document(
      `${id}/plan`,
      "## Steps\nПроверить экспорт.",
      `status: approved\nexecution: ${execution}\n`,
    ),
  );
  if (execution !== "cancelled" && execution !== "not_started") {
    await write(
      root,
      `${location}/journal.md`,
      document(`${id}/journal`, "## Current State\nФикстура.", ""),
    );
  }
}
async function check(root: string) {
  return validateProject(await loadConfig(root));
}

for (const documentsRoot of ["viaferrata", "process/docs"]) {
  void test(`archive index, retired local identity and current references: ${documentsRoot}`, async (t) => {
    const root = await project(t, false);
    await write(root, "viaferrata.toml", `profile = "lite"\ndocuments_root = "${documentsRoot}"\n`);
    await write(root, `${documentsRoot}/specs/export.md`, document("srs-000001", srs));
    const archive = `${documentsRoot}/archive/changes/change-000009`;
    await bundle(root, archive, "completed", delta("remove"));
    const before = await snapshot(root);
    const archived = await check(root);
    assert.equal(exitCode(archived.diagnostics), 0);
    assert(!archived.diagnostics.some((d) => d.code === "W_FORM"));
    assert(
      archived.diagnostics.some(
        (d) => d.code === "W_HISTORY" && d.message.includes("Before найдены"),
      ),
    );
    assert.deepEqual(await snapshot(root), before);
    await fs.mkdir(path.join(root, documentsRoot, "archive/changes/change-000050"), {
      recursive: true,
    });
    assert.equal(
      (await createChange(await loadConfig(root), "Следующая задача")).id,
      "change-000051",
    );
    await write(
      root,
      `${documentsRoot}/specs/export.md`,
      document("srs-000001", srs + "\n[srs-000001/R-1]\n"),
    );
    assert(
      (await check(root)).diagnostics.some(
        (d) => d.code === "E_REFERENCE_TARGET" && d.message.includes("srs-000001/R-1"),
      ),
    );
  });
}

void test("future add exempts only its Changes reference; malformed delta and ordinary link still fail", async (t) => {
  const root = await project(t, false);
  const location = "viaferrata/changes/change-000001";
  await bundle(root, location, "not_started", delta("add"));
  assert.equal(exitCode((await check(root)).diagnostics), 0);
  await edit(root, `${location}/spec.md`, (s) => s + "\n[srs-000001/R-1]\n");
  assert((await check(root)).diagnostics.some((d) => d.code === "E_REFERENCE_TARGET"));
  await write(
    root,
    `${location}/spec.md`,
    document("change-000001/spec", delta("add").replace("- After:", "- Text:")),
  );
  const invalid = await check(root);
  assert(invalid.diagnostics.some((d) => d.code === "W_FORM"));
  assert(invalid.diagnostics.some((d) => d.code === "E_REFERENCE_TARGET"));
});

void test("completed delta warns before and after SRS write, partial transfer is an error", async (t) => {
  const root = await project(t, false);
  const location = "viaferrata/changes/change-000001";
  await bundle(root, location, "completed", delta("add"));
  assert((await check(root)).diagnostics.some((d) => d.code === "W_SYNC_PENDING"));
  await write(
    root,
    "viaferrata/specs/export.md",
    document("srs-000001", srs.replace("R-2", "R-1")),
  );
  assert((await check(root)).diagnostics.some((d) => d.code === "W_SYNC_PENDING"));
  await fs.mkdir(path.join(root, "viaferrata/archive/changes/change-000001"), { recursive: true });
  await fs.rename(
    path.join(root, location, "spec.md"),
    path.join(root, "viaferrata/archive/changes/change-000001/spec.md"),
  );
  assert((await check(root)).diagnostics.some((d) => d.code === "E_ARCHIVE_STATE"));
});

void test("cancelled changes do not provide accepted removal evidence; no-SRS completed changes need no sync", async (t) => {
  const root = await project(t, false);
  await bundle(root, "viaferrata/archive/changes/change-000001", "cancelled", delta("remove"));
  const cancelled = await check(root);
  assert.equal(exitCode(cancelled.diagnostics), 0);
  assert(
    cancelled.diagnostics.some(
      (d) => d.code === "W_HISTORY" && d.message.includes("не восстановлена"),
    ),
  );
  await bundle(
    root,
    "viaferrata/changes/change-000002",
    "completed",
    "## Requirements\n\n### R-1: JSON\nJSON обязателен.",
  );
  assert(!(await check(root)).diagnostics.some((d) => d.code === "W_SYNC_PENDING"));
});

void test("current archive references warn with purpose; origin and same-type supersedes do not", async (t) => {
  const root = await project(t, false);
  await write(
    root,
    "viaferrata/archive/specs/old.md",
    document("srs-000001", srs, "status: superseded\n"),
  );
  await write(
    root,
    "viaferrata/specs/new.md",
    document(
      "srs-000002",
      srs + "\n- Covers:\n  - [srs-000001/R-2]\n",
      "status: approved\norigin:\n  - srs-000001\nsupersedes:\n  - srs-000001\n",
    ),
  );
  const result = await check(root);
  assert.equal(exitCode(result.diagnostics), 0);
  const warnings = result.diagnostics.filter((d) => d.code === "W_ARCHIVE_REFERENCE");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0].message, /srs-000002 → srs-000001\/R-2 \(Covers\)/);
  await edit(root, "viaferrata/specs/new.md", (s) => s.replace("- srs-000001\n", "- srs-999999\n"));
  assert((await check(root)).diagnostics.some((d) => d.code === "E_REFERENCE_TARGET"));
});

for (const [category, type, allowed] of [
  ["specs", "srs", ["cancelled", "superseded"]],
  ["adr", "adr", ["cancelled", "superseded"]],
  ["research", "research", ["completed", "cancelled", "superseded"]],
] as const) {
  void test(`archive final states and minimal shape: ${type}`, async (t) => {
    const root = await project(t, false);
    const file = `viaferrata/archive/${category}/old.md`;
    for (const status of [...allowed, "draft", "approved"]) {
      await write(
        root,
        file,
        document(
          `${type}-000001`,
          "Причина вывода: область больше не применяется.\nTODO(VF)",
          `status: ${status}\n`,
        ),
      );
      const result = await check(root);
      assert.equal(
        result.diagnostics.some((d) => d.code === "E_ARCHIVE_STATE"),
        !(allowed as readonly string[]).includes(status),
      );
      assert(!result.diagnostics.some((d) => ["W_FORM", "E_DRAFT_PLACEHOLDER"].includes(d.code)));
    }
  });
}

void test("archive retains duplicate, YAML, location and reference integrity errors", async (t) => {
  const root = await project(t, false);
  await write(root, "viaferrata/specs/export.md", document("srs-000001", srs));
  await write(
    root,
    "viaferrata/archive/specs/export.md",
    document("srs-000001", srs, "status: cancelled\n"),
  );
  assert((await check(root)).diagnostics.some((d) => d.code === "E_DUPLICATE_ID"));
  await write(root, "viaferrata/archive/specs/broken.md", "---\nid: [\n---\n");
  assert((await check(root)).diagnostics.some((d) => d.code === "E_YAML"));
  await write(
    root,
    "viaferrata/archive/specs/wrong.md",
    document("adr-000002", "[adr-000099]", "status: cancelled\n"),
  );
  const result = await check(root);
  assert(result.diagnostics.some((d) => d.code === "E_LOCATION"));
  assert(result.diagnostics.some((d) => d.code === "E_REFERENCE_TARGET"));
});

void test("the same missing section warns outside archive; active placeholders remain errors", async (t) => {
  const root = await project(t, false);
  const text = document(
    "srs-000001",
    "## Requirements\n\n### R-1: JSON\nJSON обязателен.",
    "status: cancelled\n",
  );
  await write(root, "viaferrata/specs/old.md", text);
  assert((await check(root)).diagnostics.some((d) => d.code === "W_FORM"));
  await fs.mkdir(path.join(root, "viaferrata/archive/specs"), { recursive: true });
  await fs.rename(
    path.join(root, "viaferrata/specs/old.md"),
    path.join(root, "viaferrata/archive/specs/old.md"),
  );
  assert.deepEqual((await check(root)).diagnostics, []);
  await write(root, "viaferrata/specs/new.md", document("srs-000002", srs + "\nTODO(VF)\n"));
  assert((await check(root)).diagnostics.some((d) => d.code === "E_DRAFT_PLACEHOLDER"));
});

void test("new reserves an occupied archive filename as well as incomplete directories", async (t) => {
  const root = await project(t, false);
  await write(root, "viaferrata/archive/changes/change-000075", "Остаток неполного переноса");
  assert.equal(
    (await createChange(await loadConfig(root), "Следующая задача")).id,
    "change-000076",
  );
});

void test("deleting an unstarted bundle leaves no Journal and releases its number", async (t) => {
  const root = await project(t, false);
  const config = await loadConfig(root);
  const first = await createChange(config, "Неначатая задача");
  assert.equal(first.id, "change-000001");
  const directory = path.join(root, "viaferrata/changes/change-000001");
  assert.deepEqual((await fs.readdir(directory)).sort(), ["intent.md", "plan.md", "spec.md"]);
  await fs.rm(directory, { recursive: true });
  assert.deepEqual((await check(root)).diagnostics, []);
  assert.equal((await createChange(config, "Новая задача")).id, "change-000001");
  assert.deepEqual((await fs.readdir(directory)).sort(), ["intent.md", "plan.md", "spec.md"]);
});
