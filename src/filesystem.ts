import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { CommandError, errorCode } from "./diagnostics.ts";

// Check each existing component before reading/writing; no symlink traversal.
export async function checkPath(
  target: string,
  missingAllowed = true,
  io: { lstat(path: string): Promise<Stats> } = fs,
) {
  const absolute = path.resolve(target);
  const { root } = path.parse(absolute);

  let cursor = root;
  for (const component of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, component);
    try {
      const st = await io.lstat(cursor);
      if (st.isSymbolicLink()) {
        throw new CommandError(
          "E_UNSUPPORTED",
          "Симлинки не поддерживаются; используйте обычный путь.",
          cursor,
        );
      }
    } catch (error) {
      if (errorCode(error) === "ENOENT" && missingAllowed) {
        return;
      }

      throw error;
    }
  }
}

// Both commands must close their handles without replacing an earlier write failure.
export async function writeAndClose(
  handle: { close(): Promise<void> },
  write: () => Promise<void>,
) {
  const failures: unknown[] = [];
  try {
    await write();
  } catch (error) {
    failures.push(error);
  }

  try {
    await handle.close();
  } catch (error) {
    failures.push(error);
  }

  if (failures.length === 1) {
    throw failures[0];
  }

  if (failures.length > 1) {
    throw new AggregateError(failures, "Ошибки записи и закрытия файла");
  }
}
