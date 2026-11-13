import fs from "node:fs/promises";
import path from "node:path";
import { loadConfig } from "../config.ts";
import { validateProject } from "../commands/validate.ts";
import { createChange } from "../commands/new.ts";
import { initProject } from "../commands/init.ts";
import { packageRoot } from "../resources.ts";
import {
  CommandError,
  errorMessage,
  diagnostic,
  exitCode,
  formatDiagnostic,
} from "../diagnostics.ts";

import { argumentsFor } from "./arguments.ts";
import {
  help,
  initReport,
  createdReport,
  validationReport,
  failedValidationReport,
} from "./output.ts";

export async function main(
  argv = process.argv.slice(2),
  output: Pick<Console, "log" | "error"> = console,
) {
  let root = process.cwd();
  let validating = false;
  try {
    if (Number(process.versions.node.split(".")[0]) !== 24)
      throw new CommandError(
        "E_RUNTIME",
        "Поддерживается Node.js 24.x; используйте этот runtime.",
        "vf",
      );
    const args = argumentsFor(argv);
    validating = args.command === "validate";
    if (args.command === "help") {
      output.log(help);
      return 0;
    }
    if (args.command === "version") {
      const pkg: { version: string } = JSON.parse(
        await fs.readFile(new URL("package.json", packageRoot), "utf8"),
      );
      output.log(pkg.version);
      return 0;
    }
    root = path.resolve(args.root);
    if (args.command === "init") {
      output.log(initReport(await initProject(root, args.profile)));
      return 0;
    }
    const config = await loadConfig(root);
    if (args.command === "new") {
      const result = await createChange(config, args.title);
      for (const item of result.diagnostics)
        output.error(formatDiagnostic(item));
      if (result.id) output.log(createdReport(config, result.id));
      return exitCode(result.diagnostics);
    }
    const result = await validateProject(config);
    for (const item of result.diagnostics) output.error(formatDiagnostic(item));
    for (const line of validationReport(config, result)) output.log(line);
    return exitCode(result.diagnostics);
  } catch (error) {
    const file = error instanceof CommandError ? error.file : "vf";
    const d = diagnostic(
      path.isAbsolute(file) ? path.relative(root, file) || "." : file,
      error instanceof CommandError ? error.code : "E_IO",
      error instanceof CommandError
        ? error.message
        : `Не удалось выполнить команду: ${errorMessage(error)}; проверьте окружение и пакет.`,
    );
    output.error(formatDiagnostic(d));
    if (validating) {
      output.log(failedValidationReport(root));
    }
    return 2;
  }
}
