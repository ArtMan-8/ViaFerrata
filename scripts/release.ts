import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

try {
  const [mode, input, ...extra] = process.argv.slice(2);

  if ((mode !== "dry-run" && mode !== "publish") || !input?.trim() || extra.length > 0) {
    throw new Error("Использование: npm run release:dry-run|release:publish -- <архив.tgz>");
  }

  const archive = path.resolve(input);

  if (!archive.endsWith(".tgz") || !(await fs.stat(archive)).isFile()) {
    throw new Error("Нужен существующий файл .tgz.");
  }

  const args = ["publish", archive, "--tag", "latest", "--registry", "https://registry.npmjs.org"];

  if (mode === "dry-run") {
    args.push("--dry-run");
  }

  const result = spawnSync("npm", args, { stdio: "inherit" });

  if (result.error) {
    throw result.error;
  }

  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
