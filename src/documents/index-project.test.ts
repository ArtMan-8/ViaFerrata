import assert from "node:assert/strict";
import test from "node:test";

import { createChange } from "../commands/new.ts";
import { validateProject } from "../commands/validate.ts";
import { loadConfig } from "../config.ts";
import { project, write } from "../tests/helpers.ts";
import { indexProject } from "./index-project.ts";

void test("project validation retains invalid-metadata documents and new only requires the identity index", async (t) => {
  const root = await project(t, false);
  const relative = "viaferrata/changes/change-000050/intent.md";
  const raw = "---\nid: change-000050/intent\n---\n# Черновик\nTODO(VF)\n";
  await write(root, relative, raw);
  const config = await loadConfig(root);
  const indexed = await indexProject(config);
  assert.deepEqual(indexed.diagnostics, []);
  assert.equal(indexed.documents.length, 1);
  assert(!("body" in indexed.documents[0]));
  const checked = await validateProject(config);
  assert(checked.diagnostics.some((d) => d.code === "E_DRAFT_PLACEHOLDER"));
  assert(checked.diagnostics.some((d) => d.code === "E_STRUCTURE"));
  assert.equal((await createChange(config, "Следующая задача")).id, "change-000051");

  await write(root, "viaferrata/specs/broken.md", "# Нет метаданных\n");
  const invalid = await validateProject(config);
  const document = invalid.documents.find((d) => d.file === "viaferrata/specs/broken.md");
  assert(document);
  assert.equal(document.raw, "# Нет метаданных\n");
  assert.equal(document.metadata, null);
  assert.equal(document.body, null);
  assert(invalid.diagnostics.some((d) => d.file === document.file && d.code === "E_YAML"));
  assert((await indexProject(config)).diagnostics.some((d) => d.code === "E_YAML"));
});
