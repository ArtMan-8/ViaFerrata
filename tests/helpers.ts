import type { TestContext } from "node:test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

export const repo = fileURLToPath(new URL("../", import.meta.url));
export const fixtureRoot = path.join(repo, "tests/fixtures/validation");
export const cli = path.join(repo, "bin/vf.ts");
export async function temporary(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vf-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
export async function project(t: TestContext, populated = true) {
  const dir = await temporary(t);
  if (populated)
    await fs.cp(path.join(fixtureRoot, "base"), dir, { recursive: true });
  else
    await fs.writeFile(path.join(dir, "viaferrata.toml"), 'profile = "lite"\n');
  return dir;
}
export function run(args: string[], cwd: string, binary = cli) {
  const result = spawnSync(process.execPath, [binary, ...args], {
    cwd,
    encoding: "utf8",
    timeout: 30000,
  });
  if (result.error) throw result.error;
  return { ...result, text: result.stdout + result.stderr };
}
export async function write(
  root: string,
  relative: string,
  body: string | Uint8Array,
) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}
export async function edit(
  root: string,
  relative: string,
  transform: (source: string) => string,
) {
  const file = path.join(root, relative);
  await fs.writeFile(file, transform(await fs.readFile(file, "utf8")));
}
export async function snapshot(root: string) {
  const data: Record<string, { content: string; mtime: number }> = {};
  async function visit(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await visit(p);
      else if (e.isFile())
        data[path.relative(root, p)] = {
          content: (await fs.readFile(p)).toString("base64"),
          mtime: (await fs.stat(p)).mtimeMs,
        };
    }
  }
  await visit(root);
  return data;
}
