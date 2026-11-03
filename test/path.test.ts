import { equal } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

test("AC-8: --version works from a path with a space and Cyrillic", async () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const directory = await mkdtemp(join(tmpdir(), "viaferrata тест "));

  try {
    for (const entry of ["bin", "src", "package.json"]) {
      await cp(join(root, entry), join(directory, entry), { recursive: true });
    }

    const result = spawnSync(
      process.execPath,
      [join(directory, "bin", "vf.mjs"), "--version"],
      {
        cwd: directory,
        encoding: "utf8",
      },
    );

    equal(result.status, 0, result.stderr);
    const manifest = JSON.parse(
      await readFile(join(root, "package.json"), "utf8"),
    ) as { version: string };
    equal(result.stdout, `viaferrata ${manifest.version}\n`);
    equal(result.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
