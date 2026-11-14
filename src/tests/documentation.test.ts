import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { errorCode } from "../diagnostics.ts";
import { assertLocalLinks } from "./document-links.ts";
import { repo } from "./helpers.ts";

void test("repository documentation links resolve within this repository", async () => {
  const files = ["README.md", "AGENTS.md"];
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
