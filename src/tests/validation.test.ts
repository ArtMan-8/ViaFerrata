import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { validateProject } from "../commands/validate.ts";
import { loadConfig } from "../config.ts";
import { fixtureRoot, project, run, write, edit, snapshot, objectValue } from "./helpers.ts";

const intentPath = "viaferrata/changes/change-000042/intent.md";
const planPath = "viaferrata/changes/change-000042/plan.md";
const specPath = "viaferrata/changes/change-000042/spec.md";

for (const documentsRoot of ["viaferrata", "process"]) {
  void test(`empty change directory is diagnosed under ${documentsRoot}`, async (t) => {
    const root = await project(t, false);
    await write(root, "viaferrata.toml", `profile = "lite"\ndocuments_root = "${documentsRoot}"\n`);
    assert.equal(run(["validate"], root).status, 0);
    const directory = `${documentsRoot}/changes/change-000007`;
    await fs.mkdir(path.join(root, directory), { recursive: true });
    const before = await snapshot(root);
    const result = run(["validate"], root);
    assert.equal(result.status, 1, result.text);
    for (const type of ["intent", "spec", "plan"]) {
      assert(
        result.text
          .split("\n")
          .some(
            (line) =>
              line.startsWith(`${directory}:1:1 E_STRUCTURE:`) && line.includes(`${type}.md`),
          ),
        result.text,
      );
    }
    assert.deepEqual(await snapshot(root), before);
    const created = run(["new", "Следующая задача"], root);
    assert.equal(created.status, 0, created.text);
    assert.match(created.text, /change-000008/);
  });
}

void test("non-Markdown residue and malformed document do not hide an incomplete bundle", async (t) => {
  const root = await project(t, false);
  await write(root, "viaferrata/changes/change-000009/residue.txt", "partial write");
  assert.equal(run(["validate"], root).status, 1);
  await write(root, "viaferrata/changes/change-000009/intent.md", "# Нет метаданных\n");
  const result = run(["validate"], root);
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /E_YAML/);
  assert.match(result.text, /E_STRUCTURE/);
});

void test("complete existing bundle still requires missing members", async (t) => {
  const root = await project(t);
  await fs.unlink(path.join(root, specPath));
  await fs.unlink(path.join(root, planPath));
  const result = run(["validate"], root);
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /E_STRUCTURE: \[complete-change\] Нет обязательного spec\.md/);
  assert.match(result.text, /E_STRUCTURE: \[complete-change\] Нет обязательного plan\.md/);
});

void test("only immediate directories with valid change numbers define empty bundles", async (t) => {
  const root = await project(t, false);
  for (const name of ["change-000000", "change-1000000", "notes/change-000001"]) {
    await fs.mkdir(path.join(root, "viaferrata/changes", name), {
      recursive: true,
    });
  }
  await write(root, "viaferrata/changes/change-000002", "reserved filename");
  const result = run(["validate"], root);
  assert.equal(result.status, 0, result.text);
});

for (const value of [" ", "   ", "\u00a0"]) {
  void test(`whitespace documents_root rejected before writes: ${JSON.stringify(value)}`, async (t) => {
    const root = await project(t, false);
    await write(root, "viaferrata.toml", `profile = "lite"\ndocuments_root = "${value}"\n`);
    const before = await snapshot(root);
    for (const args of [["validate"], ["new", "Ошибка конфигурации"]]) {
      const result = run(args, root);
      assert.equal(result.status, 2, result.text);
      assert.match(result.text, /E_CONFIG/);
    }
    assert.deepEqual(await snapshot(root), before);
  });
}

void test("nonempty documents_root retains leading, internal and trailing spaces", async (t) => {
  const root = await project(t, false);
  await write(root, "viaferrata.toml", 'profile = "lite"\ndocuments_root = " my docs "\n');
  const result = run(["new", "Путь с пробелами"], root);
  assert.equal(result.status, 0, result.text);
  assert((await fs.stat(path.join(root, " my docs /changes/change-000001/intent.md"))).isFile());
  const checked = run(["validate"], root);
  assert.equal(checked.status, 1, checked.text);
  assert.match(checked.text, /E_DRAFT_PLACEHOLDER/);
  assert(!checked.text.includes("E_CONFIG"));
});

interface ValidationCase {
  name: string;
  overlay?: string;
  remove?: string[];
  exitCode: number;
  errors: { path: string; code: string }[];
  warnings: { path: string; code: string }[];
}
// Independently authored test data, kept separate from the runtime parser.
const rawCases: unknown = JSON.parse(
  await fs.readFile(path.join(fixtureRoot, "cases.json"), "utf8"),
);
assert(Array.isArray(rawCases));
const cases = rawCases.map((value: unknown): ValidationCase => {
  objectValue(value);
  assert(typeof value.name === "string" && typeof value.exitCode === "number");
  assert(value.overlay === undefined || typeof value.overlay === "string");
  const remove = value.remove;
  assert(
    remove === undefined ||
      (Array.isArray(remove) && remove.every((item: unknown) => typeof item === "string")),
  );
  function diagnostics(items: unknown) {
    assert(Array.isArray(items));
    return items.map((item: unknown) => {
      objectValue(item);
      assert(typeof item.path === "string" && typeof item.code === "string");
      return { path: item.path, code: item.code };
    });
  }
  return {
    name: value.name,
    exitCode: value.exitCode,
    overlay: value.overlay,
    remove,
    errors: diagnostics(value.errors),
    warnings: diagnostics(value.warnings),
  };
});
for (const fixture of cases) {
  void test(`independent fixture: ${fixture.name}`, async (t) => {
    const root = await project(t);
    if (fixture.overlay) {
      await fs.cp(path.join(fixtureRoot, fixture.overlay), root, {
        recursive: true,
      });
    }
    for (const file of fixture.remove ?? []) {
      await fs.unlink(path.join(root, file));
    }
    const result = run(["validate"], root);
    assert.equal(result.status, fixture.exitCode, result.text);
    for (const expected of [...fixture.errors, ...fixture.warnings]) {
      assert(
        result.text
          .split("\n")
          .some((line) => line.startsWith(expected.path + ":") && line.includes(expected.code)),
        result.text,
      );
    }
    if (fixture.exitCode === 0) {
      assert(!/\bE_[A-Z_]+\b/.test(result.text), result.text);
    }
    assert(!result.text.includes("at Module"), result.text);
    if (fixture.name === "strict-structural-only") {
      assert.match(result.text, /Профиль: strict/);
      assert.match(result.text, /Полная поддержка lite\/strict отсутствует/);
    }
  });
}

void test("validate twice leaves bytes, paths, dates and mtime unchanged", async (t) => {
  const root = await project(t);
  const before = await snapshot(root);
  assert.equal(run(["validate"], root).status, 0);
  assert.equal(run(["validate"], root).status, 0);
  assert.deepEqual(await snapshot(root), before);
});

void test("BOM and CRLF accepted without rewriting", async (t) => {
  const root = await project(t);
  await edit(root, intentPath, (s) => "\uFEFF" + s.replaceAll("\n", "\r\n"));
  const before = await snapshot(root);
  assert.equal(run(["validate"], root).status, 0);
  assert.deepEqual(await snapshot(root), before);
});

void test("a scalar containing << is not a merge key; standard string tags remain valid YAML", async (t) => {
  const root = await project(t);
  await edit(root, specPath, (s) => s.replace('"src/export.js"', '"<<"'));
  await edit(root, intentPath, (s) => s.replace("status: draft", "status: !!str draft"));
  const result = run(["validate"], root);
  assert.equal(result.status, 0, result.text);
});

void test("escaped and Markdown reference links do not create logical references", async (t) => {
  const root = await project(t);
  await edit(
    root,
    intentPath,
    (s) =>
      s +
      "\n\\[srs-099999/R-1]\n\n[srs-009998/R-1](https://example.org)\n\n[srs-009997/R-1]\n\n[srs-009997/R-1]: https://example.org\n",
  );
  const result = run(["validate"], root);
  assert.equal(result.status, 0, result.text);
});

void test("inline HTML is excluded, but an ordinary reference after it is checked", async (t) => {
  const root = await project(t);
  await edit(
    root,
    intentPath,
    (s) => s + "\n<span><em>[srs-099999/R-1]</em></span> [srs-000007/R-1]\n",
  );
  assert.equal(run(["validate"], root).status, 0);
  await edit(root, intentPath, (s) => s + "\n<span>example</span> [srs-000007/R-8]\n");
  const result = run(["validate"], root);
  assert.equal(result.status, 1);
  assert.match(result.text, /E_REFERENCE_TARGET.*srs-000007\/R-8/);
});

void test("unreadable UTF-8 is an incomplete scan, never structural success", async (t) => {
  const root = await project(t);
  await fs.writeFile(path.join(root, intentPath), Buffer.from([0xff, 0xfe, 0x80]));
  const result = run(["validate"], root);
  assert.equal(result.status, 2);
  assert.match(result.text, /E_IO/);
  assert.match(result.text, /Неполный охват/);
  assert(!result.text.includes("Базовая структура проверена."));
});

const mutations: [string, string, (source: string) => string, string, number][] = [
  [
    "duplicate YAML key",
    intentPath,
    (s) => s.replace("status: draft", "status: draft\nstatus: approved"),
    "E_YAML",
    1,
  ],
  [
    "anchor",
    intentPath,
    (s) => s.replace("status: draft", "status: &state draft"),
    "E_UNSUPPORTED",
    2,
  ],
  [
    "custom tag",
    intentPath,
    (s) => s.replace("status: draft", "status: !state draft"),
    "E_UNSUPPORTED",
    2,
  ],
  [
    "flow addresses",
    intentPath,
    (s) => s.replace("status: draft", "status: draft\norigin: [change-000042/spec]"),
    "W_FORM",
    0,
  ],
  [
    "bad scope type",
    specPath,
    (s) => s.replace('scope:\n  - "src/export.js"', "scope: src/export.js"),
    "W_FORM",
    0,
  ],
  [
    "forbidden type",
    intentPath,
    (s) => s.replace("status: draft", "status: draft\ntype: intent"),
    "W_FORM",
    0,
  ],
  ["execution enum", planPath, (s) => s.replace("not_started", "done"), "W_FORM", 0],
  ["missing execution", planPath, (s) => s.replace("execution: not_started\n", ""), "W_FORM", 0],
  [
    "missing Verification",
    intentPath,
    (s) => s.replace("- Verification:", "- Method:"),
    "W_FORM",
    0,
  ],
  ["bad heading level", intentPath, (s) => s.replace("### AC-1:", "#### AC-1:"), "W_FORM", 1],
  ["bad local number", intentPath, (s) => s.replace("### AC-1:", "### AC-01:"), "W_FORM", 1],
  [
    "bad wave execution",
    planPath,
    (s) => s.replace("Execution: sequential", "Execution: concurrent"),
    "W_FORM",
    0,
  ],
  [
    "duplicate step",
    planPath,
    (s) => s + "\n- [ ] P-1: Повторный шаг.\n",
    "E_DUPLICATE_LOCAL_ID",
    1,
  ],
  ["bad step syntax", planPath, (s) => s.replace("- [ ] P-1:", "- [X] P-1:"), "W_FORM", 0],
  [
    "unsupported supersedes",
    specPath,
    (s) => s.replace("status: draft", "status: draft\nsupersedes:\n  - change-000042/spec"),
    "E_UNSUPPORTED",
    2,
  ],
];
for (const [name, file, transform, code, status] of mutations) {
  void test(`schema: ${name}`, async (t) => {
    const root = await project(t);
    await edit(root, file, transform);
    const result = run(["validate"], root);
    assert.equal(result.status, status, result.text);
    assert(result.text.includes(code), result.text);
  });
}

void test("document types, YAML addresses and Journal V-ID; completed is not evidence", async (t) => {
  const root = await project(t);
  await write(
    root,
    "viaferrata/research/decision.md",
    '---\nid: research-000001\nstatus: completed\ncreated: "2026-11-10"\nupdated: "2026-11-10"\n---\n# Исследование\n',
  );
  await write(
    root,
    "viaferrata/adr/choice.md",
    '---\nid: adr-000001\nstatus: approved\ncreated: "2026-11-10"\nupdated: "2026-11-10"\n---\n# Решение\n',
  );
  await edit(root, intentPath, (s) =>
    s.replace(
      "status: draft",
      "status: draft\nresearch:\n  - research-000001\nadr:\n  - adr-000001\norigin:\n  - change-000042",
    ),
  );
  await edit(root, planPath, (s) => s.replace("not_started", "completed"));
  assert.match(run(["validate"], root).text, /E_STRUCTURE/);
  await write(
    root,
    "viaferrata/changes/change-000042/journal.md",
    '---\nid: change-000042/journal\ncreated: "2026-11-10"\nupdated: "2026-11-10"\n---\n# Журнал\n\n## Current State\nТестовая фикстура.\n\n## Significant Events\nПример.\n\n## Verification and Result\n\n### Verification\n\n#### V-1: Пример\n\n- Verifies:\n  - [change-000042/intent/AC-1]\n\n### Result\nЭто не реальное evidence.\n',
  );
  const result = run(["validate"], root);
  assert.equal(result.status, 0, result.text);
  assert.match(result.text, /Не проверены:.*evidence и завершение/);
});

void test("wrong YAML target type and a missing standalone document are diagnosed", async (t) => {
  const root = await project(t);
  await edit(root, intentPath, (s) =>
    s.replace("status: draft", "status: draft\nresearch:\n  - srs-000007\nadr:\n  - adr-099999"),
  );
  const result = run(["validate"], root);
  assert.equal(result.status, 1);
  assert.match(result.text, /E_FIELD/);
  assert.match(result.text, /E_REFERENCE_TARGET/);
});

void test("duplicates point at both files and broken reference points at exact source", async (t) => {
  const root = await project(t);
  await edit(root, intentPath, (s) => s.replace("srs-000007/R-1", "srs-000007/R-8"));
  const data = await validateProject(await loadConfig(root));
  const d = data.diagnostics.find(
    (item) => item.code === "E_REFERENCE_TARGET" && item.file === intentPath,
  );
  const lines = (await fs.readFile(path.join(root, intentPath), "utf8")).split("\n");
  assert(d, "Expected diagnostic at the broken reference");
  assert.equal(lines[d.line - 1].slice(d.column - 1), "[srs-000007/R-8]");
});

void test("symlinked documents fail without following external targets", async (t) => {
  const root = await project(t);
  await fs.symlink("/does-not-exist", path.join(root, "viaferrata/specs/linked.md"));
  const result = run(["validate"], root);
  assert.equal(result.status, 2);
  assert.match(result.text, /E_UNSUPPORTED/);
  assert.match(result.text, /Неполный охват/);
});

void test("Plan coverage follows direct and same-change AC Covers edges under the selected profile", async (t) => {
  const root = await project(t);
  const requirement = "change-000042/spec/R-1";
  await edit(root, specPath, (s) =>
    s.replace("## Requirements", "## Requirements\n\n### R-1: Колонки"),
  );
  const validate = () => run(["validate"], root);
  assert.equal(validate().status, 0);
  await write(
    root,
    "viaferrata.toml",
    'profile="lite"\nrequired_checks=["plan-requirement-coverage"]',
  );
  let result = validate();
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /E_PLAN_COVERAGE.*R-1/);
  await write(root, "viaferrata.toml", 'profile="strict"\nrequired_checks=[]');
  await edit(root, planPath, (s) => s + "\nУпоминание [" + requirement + "].\n");
  assert.equal(validate().status, 1);
  await edit(root, intentPath, (s) => s.replace("[srs-000007/R-1]", "[" + requirement + "]"));
  result = validate();
  assert.equal(result.status, 0, result.text);
  await edit(root, planPath, (s) =>
    s.replace("[change-000042/intent/AC-1]", "[" + requirement + "]"),
  );
  assert.equal(validate().status, 0);
  await edit(root, planPath, (s) => s.replace("  - Covers:", "  - Verification:"));
  assert.equal(validate().status, 1);
  const vibe = await project(t, false);
  await write(vibe, "viaferrata.toml", 'profile="strict"');
  assert.equal(run(["validate"], vibe).status, 0);
});

void test("coverage uses declared Covers in the same working bundle and preserves core validation", async (t) => {
  const root = await project(t);
  await write(root, "viaferrata.toml", 'profile="strict"');
  await edit(root, specPath, (s) =>
    s.replace("## Requirements", "## Requirements\n\n### R-1: Требование"),
  );
  await edit(root, intentPath, (s) => s.replace("[srs-000007/R-1]", "`[change-000042/spec/R-1]`"));
  const base = path.join(root, "viaferrata/changes/change-000042");
  const other = path.join(root, "viaferrata/changes/change-000043");
  await fs.cp(base, other, { recursive: true });
  for (const name of ["intent", "spec", "plan"]) {
    await edit(root, "viaferrata/changes/change-000043/" + name + ".md", (s) =>
      s.replaceAll("change-000042", "change-000043"),
    );
  }
  await edit(root, "viaferrata/changes/change-000043/intent.md", (s) =>
    s.replace("`[change-000043/spec/R-1]`", "[change-000042/spec/R-1]"),
  );
  await edit(root, planPath, (s) =>
    s.replace("/intent/AC-1]", "/intent/AC-1]\n    - [change-000043/intent/AC-1]"),
  );
  let result = run(["validate"], root);
  assert.equal(result.status, 1);
  assert.match(result.text, /E_PLAN_COVERAGE:.*change-000042\/spec\/R-1/);
  await edit(root, planPath, (s) =>
    s.replace("[change-000043/intent/AC-1]", "[change-000042/spec/R-1]"),
  );
  await edit(root, "viaferrata/changes/change-000043/plan.md", (s) =>
    s.replace("not_started", "cancelled"),
  );
  await fs.mkdir(path.join(root, "viaferrata/archive/changes"), { recursive: true });
  await fs.rename(other, path.join(root, "viaferrata/archive/changes/change-000043"));
  result = run(["validate"], root);
  assert.equal(result.status, 0, result.text);
  await write(root, "viaferrata.toml", 'profile="lite"\nrequired_checks=[]');
  await edit(root, planPath, (s) =>
    s.replace("[change-000042/spec/R-1]", "[change-000042/spec/R-99]"),
  );
  result = run(["validate"], root);
  assert.match(result.text, /E_REFERENCE_TARGET/);
  assert.equal(result.status, 1);
});

void test("configuration rule IDs survive command error handling", async (t) => {
  const root = await project(t, false);
  for (const [toml, id] of [
    ['profile="fast"', "supported-profile"],
    ['profile="lite"\nunexpected=true', "known-config-keys"],
    ['profile="lite"\nrequired_checks=["document-title"]', "selectable-check"],
  ]) {
    await write(root, "viaferrata.toml", toml);
    for (const args of [["init"], ["new", "Проверка"], ["validate"]]) {
      const result = run(args, root);
      assert.equal(result.status, 2, result.text);
      assert.match(result.stderr, /E_CONFIG/);
      assert.ok(result.stderr.includes(`[${id}]`), result.stderr);
    }
  }
});

void test("form warnings preserve distinct rule IDs and apply only to working documents", async (t) => {
  const root = await project(t);
  const file = "viaferrata/specs/export.md";
  await edit(root, file, (text) =>
    text.replace(/^# .+$/m, "").replace("## Requirements", "## Items"),
  );
  const config = await loadConfig(root);
  const errors = async () =>
    (await validateProject(config)).diagnostics.filter((item) => item.code === "W_FORM");
  const ids = (await errors()).map((item) => item.ruleId);
  assert.ok(ids.includes("document-title"));
  assert.ok(ids.includes("required-sections"));
  const archived = path.join(root, "viaferrata/archive/specs");
  await fs.mkdir(archived, { recursive: true });
  await fs.rename(path.join(root, file), path.join(archived, "export.md"));
  assert.equal((await errors()).length, 0);
});

void test("scope and reference lists have distinct rules and archive policies", async (t) => {
  const root = await project(t);
  await edit(root, specPath, (s) =>
    s.replace('scope:\n  - "src/export.js"', "scope: bad\norigin: bad"),
  );
  const working = run(["validate"], root);
  assert.equal(working.status, 1, working.text);
  assert.match(working.stderr, /W_FORM: \[scope-list\] scope/);
  assert.match(working.stderr, /E_REFERENCE_SYNTAX: \[reference-list\] origin/);

  await edit(root, planPath, (s) => s.replace("execution: not_started", "execution: cancelled"));
  const archive = path.join(root, "viaferrata/archive/changes");
  await fs.mkdir(archive, { recursive: true });
  await fs.rename(path.join(root, path.dirname(specPath)), path.join(archive, "change-000042"));
  const archived = run(["validate"], root);
  assert.equal(archived.status, 1, archived.text);
  assert.doesNotMatch(archived.stderr, /\[scope-list\]/);
  assert.match(archived.stderr, /E_REFERENCE_SYNTAX: \[reference-list\] origin/);
});

void test("wave diagnostics identify each independent violation", async (t) => {
  const root = await project(t);
  const original = await fs.readFile(path.join(root, planPath), "utf8");
  for (const execution of [true, false]) {
    for (const steps of [true, false]) {
      let plan = original;
      if (!execution) {
        plan = plan.replace("Execution: sequential", "Execution: unknown");
      }
      if (!steps) {
        plan = plan.slice(0, plan.indexOf("- [ ] P-1"));
      }
      await write(root, planPath, plan);
      const result = run(["validate"], root);
      assert.equal(result.status, 0, result.text);
      assert.equal(result.stderr.includes("W_FORM: [wave-execution]"), !execution);
      assert.equal(result.stderr.includes("W_FORM: [wave-steps]"), !steps);
    }
  }
});

void test("archive location and execution violations are independent", async (t) => {
  const root = await project(t);
  const archive = path.join(root, "viaferrata/archive/changes/change-000042");
  await fs.mkdir(archive, { recursive: true });
  await fs.rename(path.join(root, specPath), path.join(archive, "spec.md"));
  for (const split of [true, false]) {
    if (!split) {
      for (const file of [intentPath, planPath]) {
        await fs.rename(path.join(root, file), path.join(archive, path.basename(file)));
      }
    }
    const file = split ? planPath : path.relative(root, path.join(archive, "plan.md"));
    for (const execution of ["cancelled", "not_started"]) {
      await edit(root, file, (s) => s.replace(/^execution: .+$/m, `execution: ${execution}`));
      const result = run(["validate"], root);
      const open = execution === "not_started";
      assert.equal(result.status, split || open ? 1 : 0, result.text);
      assert.equal(result.stderr.includes("E_ARCHIVE_STATE: [archive-change-location]"), split);
      assert.equal(result.stderr.includes("E_ARCHIVE_STATE: [archive-change-execution]"), open);
    }
  }

  // A second copy with the same ID must not hide the split location.
  await fs.copyFile(path.join(archive, "spec.md"), path.join(root, specPath));
  const duplicate = run(["validate"], root);
  assert.match(duplicate.stderr, /E_DUPLICATE_ID: \[unique-document-id\]/);
  assert.match(duplicate.stderr, /E_ARCHIVE_STATE: \[archive-change-location\]/);
});

void test("merged placement rules retain specific Journal and ADR guidance", async (t) => {
  const root = await project(t);
  const header = 'created: "2026-11-22"\nupdated: "2026-11-22"\n---\n';
  await write(
    root,
    path.join(path.dirname(planPath), "journal.md"),
    "---\nid: change-000042/journal\n" +
      header +
      "# Journal\n\n## Verification and Result\n\n### Result\n\n#### V-1: Экспорт\n",
  );
  await write(
    root,
    "viaferrata/adr/export.md",
    "---\nid: adr-000001\nstatus: draft\n" +
      header +
      "# ADR\n\n## Context and Problem Statement\n\n## Decision Outcome\n\n### Consequences\n",
  );
  const result = run(["validate"], root);
  assert.equal(result.status, 0, result.text);
  assert.match(result.stderr, /W_FORM: \[local-declaration-location\].*подразделе Verification/);
  assert.match(
    result.stderr,
    /W_FORM: \[required-sections\].*Confirmation внутри Decision Outcome/,
  );
});

void test("scenario coverage follows typed incoming edges from the same change", async (t) => {
  const root = await project(t);
  const base = "change-000042/";
  const requirement = base + "spec/R-1";
  const criterion = base + "intent/AC-1";
  const scenario = base + "spec/S-1";
  await write(root, "viaferrata.toml", 'profile="strict"');
  await edit(root, planPath, (s) => s.replace(criterion, scenario));
  await edit(root, intentPath, (s) => s.replace("srs-000007/R-1", requirement));
  await edit(
    root,
    specPath,
    (s) =>
      s.replace("## Requirements", "## Requirements\n\n### R-1: Выгрузка") +
      "\n## Scenarios\n\n### S-1: Выборка\n\n- Covers:\n  - [" +
      criterion +
      "]\n",
  );
  const validate = async () => validateProject(await loadConfig(root));
  for (const target of [criterion, requirement]) {
    const data = await validate();
    assert(!data.diagnostics.some((d) => d.severity === "error"));
    assert(data.incoming.get(target)?.some((edge) => edge.source === scenario));
    await edit(root, specPath, (s) =>
      s.replace("  - [" + criterion + "]", "  - [" + requirement + "]"),
    );
  }
  await edit(root, specPath, (s) =>
    s.replace("  - [" + requirement + "]", "  - Пример [" + requirement + "]"),
  );
  assert((await validate()).diagnostics.some((d) => d.code === "E_PLAN_COVERAGE"));
  await edit(root, specPath, (s) =>
    s.replace("Пример [" + requirement + "]", "[" + base + "plan/P-1]"),
  );
  assert(
    (await validate()).diagnostics.some((d) => d.ruleId === "relation-type" && d.file === specPath),
  );
  // Drop the declared target while leaving its consumer untouched.
  await edit(root, specPath, (s) => s.replace("### S-1:", "### S-2:"));
  assert(
    (await validate()).diagnostics.some(
      (d) => d.code === "E_REFERENCE_TARGET" && d.file === planPath,
    ),
  );
});

void test("Depends on rejects self, cross-plan and cyclic edges", async (t) => {
  const root = await project(t);
  const original = await fs.readFile(path.join(root, planPath), "utf8");
  const other = "change-000043";
  for (const file of [intentPath, planPath, specPath]) {
    const content = await fs.readFile(path.join(root, file), "utf8");
    await write(
      root,
      file.replace("change-000042", other),
      content.replaceAll("change-000042", other),
    );
  }
  const depends = (target: string) => "  - Depends on:\n    - [" + target + "]\n";
  const p = "change-000042/plan/P-";
  for (const [target, rule] of [
    [p + "1", "relation-self"],
    [other + "/plan/P-1", "relation-type"],
    [p + "2", "relation-cycle"],
  ]) {
    await write(
      root,
      planPath,
      original + depends(target) + "- [ ] P-2: Затем\n" + depends(p + "1"),
    );
    const result = run(["validate"], root);
    assert.equal(result.status, 1, result.text);
    assert.ok(
      result.stderr.includes("[" + rule + "]") && result.stderr.includes(target),
      result.stderr,
    );
  }
  await write(root, planPath, original + "- [ ] P-2: Затем\n" + depends(p + "1"));
  assert.equal(run(["validate"], root).status, 0);
});

void test("supersedes cycles are independent of other incoming references", async (t) => {
  const root = await project(t);
  const file = "viaferrata/specs/export.md";
  const base = await fs.readFile(path.join(root, file), "utf8");
  for (const [id, target] of [
    ["7", "8"],
    ["8", "9"],
    ["9", "7"],
  ]) {
    const field = id === "9" ? "origin" : "supersedes";
    const body = base
      .replace("srs-000007", "srs-00000" + id)
      .replace("status: draft", "status: draft\n" + field + ":\n  - srs-00000" + target);
    await write(root, id === "7" ? file : file.replace("export", id), body);
  }
  assert.equal(run(["validate"], root).status, 0);
  await edit(root, file.replace("export", "9"), (s) => s.replace("origin:", "supersedes:"));
  const result = run(["validate"], root);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[relation-cycle\].*supersedes/);
  for (const id of ["srs-000007", "srs-000008", "srs-000009"]) {
    assert.ok(result.stderr.includes(id), result.stderr);
  }
});

void test("verification coverage reports only missing explicit ACs and takes revision from their V", async (t) => {
  const root = await project(t);
  const second = "change-000042/intent/AC-2",
    first = second.replace("AC-2", "AC-1");
  await edit(
    root,
    intentPath,
    (s) => s + "\n### AC-2: Вторая выборка\n\n- Verification: Проверить выгрузку.\n",
  );
  await edit(root, planPath, (s) => s.replace("not_started", "in_progress"));
  const journal = planPath.replace("plan.md", "journal.md");
  const header =
    '---\nid: change-000042/journal\ncreated: "2026-11-23"\nupdated: "2026-11-23"\n---\n';
  const body =
    "# Проверки\n\n## Current State\n\n## Significant Events\n\n## Verification and Result\n\n### Verification\n\n" +
    "```yaml\nchecks:\n  - subject: Общая проверка\n    outcome: passed\n    revision: другая редакция\n    source: CI\n```\n\n" +
    "#### V-1: Первая проверка\n\n- Verifies:\n  - [" +
    first +
    "]\n- Revision: рабочая копия\n";
  await write(root, journal, header + body);
  for (const [toml, enabled] of [
    ['profile="lite"', false],
    ['profile="strict"', true],
    ['profile="lite"\nrequired_checks=["verification-coverage"]', true],
  ] as const) {
    await write(root, "viaferrata.toml", toml);
    const result = run(["validate"], root);
    assert.equal(result.status, 0, result.text);
    assert.equal(result.stderr.includes("W_VERIFICATION_COVERAGE"), enabled);
    assert.equal(result.stderr.includes(second), enabled);
    assert(!result.stderr.includes(first));
  }
  const validate = async () => validateProject(await loadConfig(root));
  const revisions = async () =>
    (await validate()).incoming
      .get(first)
      ?.filter((edge) => edge.kind === "Verifies")
      .map((edge) => edge.revision);
  assert.deepEqual(await revisions(), ["рабочая копия"]);
  await edit(root, journal, (s) => s.replace("- Revision: рабочая копия", "  - [" + second + "]"));
  assert.deepEqual(await revisions(), [null]);
  assert(!(await validate()).diagnostics.some((d) => d.code === "W_VERIFICATION_COVERAGE"));
  await write(root, journal, header + body);
  for (const state of ["blocked", "completed", "not_started", "cancelled"]) {
    await edit(root, planPath, (s) => s.replace(/^execution: .+$/m, "execution: " + state));
    assert(!(await validate()).diagnostics.some((d) => d.code === "W_VERIFICATION_COVERAGE"));
  }
});

void test("typed links in an older form keep their identity in working and archived documents", async (t) => {
  const root = await project(t);
  await edit(root, intentPath, (s) => s.replace("## Acceptance Criteria", "## Criteria"));
  await edit(root, planPath, (s) => s.replace("not_started", "cancelled"));
  let directory = path.dirname(intentPath);
  for (const archived of [false, true]) {
    if (archived) {
      const destination = directory.replace("/changes/", "/archive/changes/");
      await fs.mkdir(path.dirname(path.join(root, destination)), { recursive: true });
      await fs.rename(path.join(root, directory), path.join(root, destination));
      directory = destination;
    }
    const file = directory + "/intent.md";
    const validate = async () =>
      (await validateProject(await loadConfig(root))).diagnostics.filter((d) => d.file === file);
    const correct = await validate();
    assert(!correct.some((d) => d.severity === "error"));
    assert.equal(
      correct.some((d) => d.code === "W_FORM"),
      !archived,
    );
    await edit(root, file, (s) => s.replace("srs-000007/R-1", "change-000042/plan/P-1"));
    const invalid = await validate();
    assert(
      invalid.some(
        (d) =>
          d.ruleId === "relation-type" &&
          d.message.includes("intent/AC-1") &&
          d.message.includes("plan/P-1"),
      ),
    );
    await edit(root, file, (s) => s.replace("change-000042/plan/P-1", "srs-000007/R-1"));
  }
});
