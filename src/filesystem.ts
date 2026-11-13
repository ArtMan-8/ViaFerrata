import fs from "node:fs/promises";
import path from "node:path";
import { CommandError, errorCode } from "./diagnostics.ts";

// Check each existing component before reading/writing; no symlink traversal.
export async function checkPath(target: string, missingAllowed = true) {
  const absolute = path.resolve(target);
  const { root } = path.parse(absolute);
  let cursor = root;
  for (const component of absolute
    .slice(root.length)
    .split(path.sep)
    .filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      const st = await fs.lstat(cursor);
      if (st.isSymbolicLink())
        throw new CommandError(
          "E_UNSUPPORTED",
          "Симлинки не поддерживаются; используйте обычный путь.",
          cursor,
        );
    } catch (error) {
      if (errorCode(error) === "ENOENT" && missingAllowed) return;
      throw error;
    }
  }
}
