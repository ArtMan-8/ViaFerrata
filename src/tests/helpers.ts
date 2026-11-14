import assert from "node:assert/strict";
import type { SpawnSyncOptionsWithStringEncoding } from "node:child_process";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

export const repo = fileURLToPath(new URL("../../", import.meta.url));

export const fixtureRoot = path.join(repo, "src/tests/fixtures/validation");

export const cli = path.join(repo, "bin/vf.ts");

export async function temporary(t: TestContext) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vf-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

export async function project(t: TestContext, populated = true) {
  const dir = await temporary(t);
  if (populated) {
    await fs.cp(path.join(fixtureRoot, "base"), dir, { recursive: true });
  } else {
    await fs.writeFile(path.join(dir, "viaferrata.toml"), 'profile = "lite"\n');
  }

  return dir;
}

export function run(args: string[], cwd: string, binary = cli) {
  return execute(process.execPath, [binary, ...args], { cwd, timeout: 30000 });
}

export function execute(
  program: string,
  args: string[],
  options: Omit<SpawnSyncOptionsWithStringEncoding, "encoding">,
) {
  const result = spawnSync(program, args, { ...options, encoding: "utf8" });
  if (result.error) {
    throw result.error;
  }

  return { ...result, text: result.stdout + result.stderr };
}

export function objectValue(value: unknown): asserts value is Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Expected an object",
  );
}

export async function packageVersion() {
  const pkg: unknown = JSON.parse(await fs.readFile(path.join(repo, "package.json"), "utf8"));
  objectValue(pkg);
  assert.equal(typeof pkg.version, "string");
  return pkg.version;
}

export async function write(root: string, relative: string, body: string | Uint8Array) {
  const file = path.join(root, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, body);
}

export async function edit(root: string, relative: string, transform: (source: string) => string) {
  const file = path.join(root, relative);
  await fs.writeFile(file, transform(await fs.readFile(file, "utf8")));
}

export async function snapshot(root: string) {
  const data: Record<
    string,
    {
      kind: "file" | "directory" | "symlink";
      mode: number;
      content?: string;
      mtime?: number;
    }
  > = {};
  async function visit(dir: string) {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      const stat = await fs.lstat(p);
      const name = path.relative(root, p);
      if (e.isDirectory()) {
        // Directory mtime changes when children are added; record presence and mode.
        data[name] = { kind: "directory", mode: stat.mode };
        await visit(p);
      } else if (e.isFile()) {
        data[name] = {
          kind: "file",
          mode: stat.mode,
          content: (await fs.readFile(p)).toString("base64"),
          mtime: stat.mtimeMs,
        };
      } else if (e.isSymbolicLink()) {
        data[name] = {
          kind: "symlink",
          mode: stat.mode,
          content: await fs.readlink(p),
          mtime: stat.mtimeMs,
        };
      } else {
        throw new Error(`Unsupported snapshot entry: ${p}`);
      }
    }
  }

  await visit(root);
  return data;
}
