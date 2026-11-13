import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fixtureRoot, project, run, write, edit, snapshot } from "./helpers.ts";
import { loadConfig } from "../src/config.ts";
import { validateProject } from "../src/commands/validate.ts";

const intentPath = "viaferrata/changes/change-000042/intent.md";
const planPath = "viaferrata/changes/change-000042/plan.md";
const specPath = "viaferrata/changes/change-000042/spec.md";

for (const documentsRoot of ["viaferrata", "process"])
  test(`empty change directory is diagnosed under ${documentsRoot}`, async (t) => {
    const root = await project(t, false);
    await write(
      root,
      "viaferrata.toml",
      `profile = "lite"\ndocuments_root = "${documentsRoot}"\n`,
    );
    assert.equal(run(["validate"], root).status, 0);
    const directory = `${documentsRoot}/changes/change-000007`;
    await fs.mkdir(path.join(root, directory), { recursive: true });
    const before = await snapshot(root);
    const result = run(["validate"], root);
    assert.equal(result.status, 1, result.text);
    for (const type of ["intent", "spec", "plan"])
      assert(
        result.text
          .split("\n")
          .some(
            (line) =>
              line.startsWith(`${directory}:1:1 E_STRUCTURE:`) &&
              line.includes(`${type}.md`),
          ),
        result.text,
      );
    assert.deepEqual(await snapshot(root), before);
    const created = run(["new", "Следующая задача"], root);
    assert.equal(created.status, 0, created.text);
    assert.match(created.text, /change-000008/);
  });

test("non-Markdown residue and malformed document do not hide an incomplete bundle", async (t) => {
  const root = await project(t, false);
  await write(
    root,
    "viaferrata/changes/change-000009/residue.txt",
    "partial write",
  );
  assert.equal(run(["validate"], root).status, 1);
  await write(
    root,
    "viaferrata/changes/change-000009/intent.md",
    "# Нет метаданных\n",
  );
  const result = run(["validate"], root);
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /E_YAML/);
  assert.match(result.text, /E_STRUCTURE/);
});

test("complete existing bundle still requires missing members", async (t) => {
  const root = await project(t);
  await fs.unlink(path.join(root, specPath));
  await fs.unlink(path.join(root, planPath));
  const result = run(["validate"], root);
  assert.equal(result.status, 1, result.text);
  assert.match(result.text, /E_STRUCTURE: Нет обязательного spec\.md/);
  assert.match(result.text, /E_STRUCTURE: Нет обязательного plan\.md/);
});

test("only immediate directories with valid change numbers define empty bundles", async (t) => {
  const root = await project(t, false);
  for (const name of ["change-000000", "change-1000000", "notes/change-000001"])
    await fs.mkdir(path.join(root, "viaferrata/changes", name), {
      recursive: true,
    });
  await write(root, "viaferrata/changes/change-000002", "reserved filename");
  const result = run(["validate"], root);
  assert.equal(result.status, 0, result.text);
});

for (const value of [" ", "   ", "\u00a0"])
  test(`whitespace documents_root rejected before writes: ${JSON.stringify(value)}`, async (t) => {
    const root = await project(t, false);
    await write(
      root,
      "viaferrata.toml",
      `profile = "lite"\ndocuments_root = "${value}"\n`,
    );
    const before = await snapshot(root);
    for (const args of [["validate"], ["new", "Ошибка конфигурации"]]) {
      const result = run(args, root);
      assert.equal(result.status, 2, result.text);
      assert.match(result.text, /E_CONFIG/);
    }
    assert.deepEqual(await snapshot(root), before);
  });

test("nonempty documents_root retains leading, internal and trailing spaces", async (t) => {
  const root = await project(t, false);
  await write(
    root,
    "viaferrata.toml",
    'profile = "lite"\ndocuments_root = " my docs "\n',
  );
  const result = run(["new", "Путь с пробелами"], root);
  assert.equal(result.status, 0, result.text);
  assert(
    (
      await fs.stat(
        path.join(root, " my docs /changes/change-000001/intent.md"),
      )
    ).isFile(),
  );
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
const cases: ValidationCase[] = JSON.parse(
  await fs.readFile(path.join(fixtureRoot, "cases.json"), "utf8"),
);
for (const fixture of cases) {
  test(`independent fixture: ${fixture.name}`, async (t) => {
    const root = await project(t);
    if (fixture.overlay)
      await fs.cp(path.join(fixtureRoot, fixture.overlay), root, {
        recursive: true,
      });
    for (const file of fixture.remove ?? [])
      await fs.unlink(path.join(root, file));
    const result = run(["validate"], root);
    assert.equal(result.status, fixture.exitCode, result.text);
    for (const expected of [...fixture.errors, ...fixture.warnings]) {
      assert(
        result.text
          .split("\n")
          .some(
            (line) =>
              line.startsWith(expected.path + ":") &&
              line.includes(expected.code),
          ),
        result.text,
      );
    }
    if (fixture.exitCode === 0)
      assert(!/\bE_[A-Z_]+\b/.test(result.text), result.text);
    assert(!result.text.includes("at Module"), result.text);
    if (fixture.name === "strict-structural-only") {
      assert.match(result.text, /Профиль: strict/);
      assert.match(result.text, /Полная поддержка lite\/strict отсутствует/);
    }
  });
}

test("validate twice leaves bytes, paths, dates and mtime unchanged", async (t) => {
  const root = await project(t);
  const before = await snapshot(root);
  assert.equal(run(["validate"], root).status, 0);
  assert.equal(run(["validate"], root).status, 0);
  assert.deepEqual(await snapshot(root), before);
});

test("BOM and CRLF accepted without rewriting", async (t) => {
  const root = await project(t);
  await edit(root, intentPath, (s) => "\uFEFF" + s.replaceAll("\n", "\r\n"));
  const before = await snapshot(root);
  assert.equal(run(["validate"], root).status, 0);
  assert.deepEqual(await snapshot(root), before);
});

test("a scalar containing << is not a merge key; standard string tags remain valid YAML", async (t) => {
  const root = await project(t);
  await edit(root, specPath, (s) => s.replace('"src/export.js"', '"<<"'));
  await edit(root, intentPath, (s) =>
    s.replace("status: draft", "status: !!str draft"),
  );
  const result = run(["validate"], root);
  assert.equal(result.status, 0, result.text);
});

test("escaped and Markdown reference links do not create logical references", async (t) => {
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

test("inline HTML is excluded, but an ordinary reference after it is checked", async (t) => {
  const root = await project(t);
  await edit(
    root,
    intentPath,
    (s) => s + "\n<span><em>[srs-099999/R-1]</em></span> [srs-000007/R-1]\n",
  );
  assert.equal(run(["validate"], root).status, 0);
  await edit(
    root,
    intentPath,
    (s) => s + "\n<span>example</span> [srs-000007/R-8]\n",
  );
  const result = run(["validate"], root);
  assert.equal(result.status, 1);
  assert.match(result.text, /E_REFERENCE_TARGET.*srs-000007\/R-8/);
});

test("unreadable UTF-8 is an incomplete scan, never structural success", async (t) => {
  const root = await project(t);
  await fs.writeFile(
    path.join(root, intentPath),
    Buffer.from([0xff, 0xfe, 0x80]),
  );
  const result = run(["validate"], root);
  assert.equal(result.status, 2);
  assert.match(result.text, /E_IO/);
  assert.match(result.text, /Неполный охват/);
  assert(!result.text.includes("Базовая структура проверена."));
});

const mutations: [
  string,
  string,
  (source: string) => string,
  string,
  number,
][] = [
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
    (s) =>
      s.replace("status: draft", "status: draft\norigin: [change-000042/spec]"),
    "E_FIELD",
    1,
  ],
  [
    "bad scope type",
    specPath,
    (s) => s.replace('scope:\n  - "src/export.js"', "scope: src/export.js"),
    "E_FIELD",
    1,
  ],
  [
    "forbidden type",
    intentPath,
    (s) => s.replace("status: draft", "status: draft\ntype: intent"),
    "E_FIELD",
    1,
  ],
  [
    "execution enum",
    planPath,
    (s) => s.replace("not_started", "done"),
    "E_ENUM",
    1,
  ],
  [
    "missing execution",
    planPath,
    (s) => s.replace("execution: not_started\n", ""),
    "E_FIELD",
    1,
  ],
  [
    "missing Verification",
    intentPath,
    (s) => s.replace("- Verification:", "- Method:"),
    "E_STRUCTURE",
    1,
  ],
  [
    "bad heading level",
    intentPath,
    (s) => s.replace("### AC-1:", "#### AC-1:"),
    "E_STRUCTURE",
    1,
  ],
  [
    "bad local number",
    intentPath,
    (s) => s.replace("### AC-1:", "### AC-01:"),
    "E_STRUCTURE",
    1,
  ],
  [
    "bad wave execution",
    planPath,
    (s) => s.replace("Execution: sequential", "Execution: concurrent"),
    "E_STRUCTURE",
    1,
  ],
  [
    "duplicate step",
    planPath,
    (s) => s + "\n- [ ] P-1: Повторный шаг.\n",
    "E_DUPLICATE_LOCAL_ID",
    1,
  ],
  [
    "bad step syntax",
    planPath,
    (s) => s.replace("- [ ] P-1:", "- [X] P-1:"),
    "E_STRUCTURE",
    1,
  ],
  [
    "unsupported supersedes",
    specPath,
    (s) =>
      s.replace(
        "status: draft",
        "status: draft\nsupersedes:\n  - change-000042/spec",
      ),
    "E_UNSUPPORTED",
    2,
  ],
];
for (const [name, file, transform, code, status] of mutations)
  test(`schema: ${name}`, async (t) => {
    const root = await project(t);
    await edit(root, file, transform);
    const result = run(["validate"], root);
    assert.equal(result.status, status, result.text);
    assert(result.text.includes(code), result.text);
  });

test("document types, YAML addresses and Journal V-ID; completed is not evidence", async (t) => {
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

test("wrong YAML target type and a missing standalone document are diagnosed", async (t) => {
  const root = await project(t);
  await edit(root, intentPath, (s) =>
    s.replace(
      "status: draft",
      "status: draft\nresearch:\n  - srs-000007\nadr:\n  - adr-099999",
    ),
  );
  const result = run(["validate"], root);
  assert.equal(result.status, 1);
  assert.match(result.text, /E_FIELD/);
  assert.match(result.text, /E_REFERENCE_TARGET/);
});

test("duplicates point at both files and broken reference points at exact source", async (t) => {
  const root = await project(t);
  await edit(root, intentPath, (s) =>
    s.replace("srs-000007/R-1", "srs-000007/R-8"),
  );
  const data = await validateProject(await loadConfig(root));
  const d = data.diagnostics.find(
    (d) => d.code === "E_REFERENCE_TARGET" && d.file === intentPath,
  );
  const lines = (await fs.readFile(path.join(root, intentPath), "utf8")).split(
    "\n",
  );
  assert(d, "Expected diagnostic at the broken reference");
  assert.equal(lines[d.line - 1].slice(d.column - 1), "[srs-000007/R-8]");
});

test("symlinked documents fail without following external targets", async (t) => {
  const root = await project(t);
  await fs.symlink(
    "/does-not-exist",
    path.join(root, "viaferrata/specs/linked.md"),
  );
  const result = run(["validate"], root);
  assert.equal(result.status, 2);
  assert.match(result.text, /E_UNSUPPORTED/);
  assert.match(result.text, /Неполный охват/);
});
