import fs from "node:fs/promises";
import path from "node:path";
import type { BinaryLike } from "node:crypto";
import { errorMessage } from "../src/diagnostics.ts";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const directories = [
  "bin",
  "src",
  "templates",
  "instructions",
  "tests",
  "scripts",
];
const rootFiles = [
  "package.json",
  "package-lock.json",
  "viaferrata.toml",
  "README.md",
  "LICENSE",
  "tsconfig.json",
  "tsconfig.build.json",
];
const sha256 = (bytes: BinaryLike) =>
  createHash("sha256").update(bytes).digest("hex");

export async function inputManifest(root: string) {
  const paths: string[] = [];
  async function visit(relative: string) {
    const absolute = path.join(root, relative);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink())
      throw new Error(`Симлинк во входах: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of await fs.readdir(absolute))
        await visit(`${relative}/${name}`);
    } else if (stat.isFile()) paths.push(relative);
    else throw new Error(`Неподдерживаемый вход: ${relative}`);
  }
  for (const relative of [...directories, ...rootFiles]) await visit(relative);
  const files = [];
  for (const relative of paths.sort())
    files.push({
      path: relative,
      sha256: sha256(await fs.readFile(path.join(root, relative))),
    });
  return {
    format: 1,
    algorithm: "SHA-256",
    serialization:
      "UTF-8(path + NUL + lowercase_hex_sha256 + LF), lexicographic path order",
    files,
    aggregate: sha256(
      files.map((file) => `${file.path}\0${file.sha256}\n`).join(""),
    ),
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = fileURLToPath(new URL("../", import.meta.url));
  try {
    process.stdout.write(
      JSON.stringify(await inputManifest(root), null, 2) + "\n",
    );
  } catch (error) {
    process.stderr.write(
      `Не удалось вычислить манифест: ${errorMessage(error)}\n`,
    );
    process.exitCode = 1;
  }
}
