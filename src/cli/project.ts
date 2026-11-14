import type { Stats } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import { CommandError, errorCode, errorMessage, isFileError } from "../diagnostics.ts";

// An existing configuration is a boundary even when it is malformed or a symlink.
export async function findProjectRoot(
  start: string,
  io: { lstat(file: string): Promise<Stats> } = fs,
): Promise<string | null> {
  let directory = path.resolve(start);
  while (true) {
    const file = path.join(directory, "viaferrata.toml");
    try {
      await io.lstat(file);
      return directory;
    } catch (error) {
      if (!isFileError(error)) {
        throw error;
      }

      if (errorCode(error) !== "ENOENT") {
        throw new CommandError(
          "E_IO",
          `${errorMessage(error)}; проверьте доступ к конфигурации.`,
          file,
        );
      }
    }

    const parent = path.dirname(directory);
    if (parent === directory) {
      return null;
    }

    directory = parent;
  }
}
