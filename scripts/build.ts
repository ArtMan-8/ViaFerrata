import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = new URL("../", import.meta.url);
const compiler = fileURLToPath(new URL("node_modules/typescript/bin/tsc", root));

// A failed build must not leave a previous runnable distribution behind.
await fs.rm(new URL("dist/", root), { recursive: true, force: true });

for (const args of [["--noEmit"], ["--project", "tsconfig.build.json"]]) {
  const result = spawnSync(process.execPath, [compiler, ...args], {
    cwd: root,
    stdio: "inherit",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

await fs.chmod(new URL("dist/bin/vf.js", root), 0o755);
