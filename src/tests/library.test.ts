import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { repo, project, run, write } from "./helpers.ts";

void test("manually filled Journal, SRS, Research and ADR forms pass the real validator", async (t) => {
  const root = await project(t);
  const forms = [
    ["journal", "viaferrata/changes/change-000042/journal.md", "change-000042/journal"],
    ["srs", "viaferrata/specs/library.md", "srs-000999"],
    ["research", "viaferrata/research/library.md", "research-000999"],
    ["adr", "viaferrata/adr/library.md", "adr-000999"],
  ];
  const rendered = [];
  for (const [type, target, id] of forms) {
    const source = await fs.readFile(path.join(repo, "templates", `${type}.md`), "utf8");
    const values: Record<string, string> = {
      change_id: "change-000042",
      document_id: id,
      date: "2026-11-12",
      title: "Тестовая форма",
    };
    const text = source.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
      assert(Object.hasOwn(values, key), key);
      return values[key];
    });
    if (type === "journal") {
      assert(!/^status:|^execution:/m.test(text));
      assert(!/^- Result: passed$/m.test(text));
    } else {
      assert.match(text, /^status: draft$/m);
    }
    rendered.push([target, text]);
    await write(root, target, text);
  }
  const draft = run(["validate"], root);
  assert.equal(draft.status, 1, draft.text);
  assert.match(draft.text, /E_DRAFT_PLACEHOLDER/);
  for (const [target, text] of rendered) {
    // Test-only content represents manual completion, not real approval or evidence.
    await write(
      root,
      target,
      text.replace(/TODO\(VF\):[^\n]*/g, "Заполненное условие тестового примера."),
    );
  }
  const filled = run(["validate"], root);
  assert.equal(filled.status, 0, filled.text);
});
