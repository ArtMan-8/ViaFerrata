import fs from "node:fs/promises";
import path from "node:path";

import { initProject } from "../commands/init.ts";
import { createChange } from "../commands/new.ts";
import { validateProject } from "../commands/validate.ts";
import { loadConfig } from "../config.ts";
import {
  CommandError,
  errorMessage,
  errorStack,
  isFileError,
  diagnostic,
  exitCode,
  formatDiagnostic,
} from "../diagnostics.ts";
import { packageRoot } from "../resources.ts";
import { argumentsFor } from "./arguments.ts";
import {
  help,
  initReport,
  createdReport,
  validationReport,
  failedValidationReport,
} from "./output.ts";
import { findProjectRoot } from "./project.ts";

export async function main(
  argv = process.argv.slice(2),
  output: Pick<Console, "log" | "error"> = console,
) {
  let root = ".";
  let validating = false;
  try {
    root = process.cwd();
    if (Number(process.versions.node.split(".")[0]) !== 24) {
      throw new CommandError(
        "E_RUNTIME",
        "Поддерживается Node.js 24.x; используйте этот runtime.",
        "vf",
      );
    }

    const args = argumentsFor(argv);
    validating = args.command === "validate";
    if (args.command === "help") {
      output.log(help);
      return 0;
    }

    if (args.command === "version") {
      let pkg: unknown;
      try {
        pkg = JSON.parse(await fs.readFile(new URL("package.json", packageRoot), "utf8"));
      } catch (error) {
        if (!(error instanceof SyntaxError) && !isFileError(error)) {
          throw error;
        }

        throw new CommandError(
          "E_IO",
          `Не удалось прочитать версию пакета: ${errorMessage(error)}; восстановите package.json.`,
          "package.json",
        );
      }
      if (
        typeof pkg !== "object" ||
        pkg === null ||
        !("version" in pkg) ||
        typeof pkg.version !== "string"
      ) {
        throw new CommandError(
          "E_IO",
          "Некорректная версия пакета; восстановите package.json.",
          "package.json",
        );
      }

      output.log(pkg.version);
      return 0;
    }

    if (args.command === "init") {
      root = path.resolve(root, args.path ?? ".");
      output.log(initReport(await initProject(root, args.profile)));
      return 0;
    }

    const found = await findProjectRoot(root);
    if (!found) {
      throw new CommandError(
        "E_CONFIG",
        "Проект не найден; выполните init или перейдите в подключённый проект.",
        path.join(root, "viaferrata.toml"),
      );
    }

    root = found;
    const config = await loadConfig(root);
    if (args.command === "new") {
      const result = await createChange(config, args.title);
      for (const item of result.diagnostics) {
        output.error(formatDiagnostic(item));
      }

      if (result.id) {
        output.log(createdReport(config, result.id));
      }

      return exitCode(result.diagnostics);
    }

    const result = await validateProject(config);
    for (const item of result.diagnostics) {
      output.error(formatDiagnostic(item));
    }

    for (const line of validationReport(config, result)) {
      output.log(line);
    }

    return exitCode(result.diagnostics);
  } catch (error) {
    const file = error instanceof CommandError ? error.file : "vf";
    const d = diagnostic(
      path.isAbsolute(file) ? path.relative(root, file) || "." : file,
      error instanceof CommandError ? error.code : "E_INTERNAL",
      error instanceof CommandError
        ? error.message
        : `Не удалось выполнить команду: ${errorMessage(error)}; проверьте окружение и пакет.`,
    );

    output.error(formatDiagnostic(d));
    if (d.code === "E_INTERNAL") {
      output.error(errorStack(error));
    }

    if (validating) {
      output.log(failedValidationReport(root));
    }

    return 2;
  }
}
