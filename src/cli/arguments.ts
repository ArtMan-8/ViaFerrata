import { parseArgs } from "node:util";

import { CommandError, errorCode } from "../diagnostics.ts";

export type Arguments =
  | { command: "help" }
  | { command: "version" }
  | { command: "validate" }
  | { command: "init"; path?: string; profile?: "lite" | "strict" }
  | { command: "new"; title: string };

export function argumentsFor(argv: string[]): Arguments {
  const usage = () =>
    new CommandError("E_USAGE", "Неверная команда, флаг или аргументы; см. vf --help.", "vf");

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        help: { type: "boolean" },
        version: { type: "boolean" },
        profile: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
  } catch (error) {
    if (errorCode(error)?.startsWith("ERR_PARSE_ARGS_")) {
      throw usage();
    }

    throw error;
  }

  const seen = new Set<string>();
  for (const token of parsed.tokens) {
    if (token.kind !== "option") {
      continue;
    }

    if (seen.has(token.name)) {
      throw usage();
    }

    seen.add(token.name);
  }

  const { values, positionals } = parsed;
  const [command, argument] = positionals;
  if (values.help || values.version) {
    if (seen.size !== 1 || positionals.length) {
      throw usage();
    }

    return { command: values.help ? "help" : "version" };
  }

  if (command === undefined && !seen.size) {
    return { command: "help" };
  }

  if (values.profile !== undefined && command !== "init") {
    throw usage();
  }

  if (command === "init" && positionals.length <= 2) {
    if (argument !== undefined && (!argument.trim() || argument.startsWith("--"))) {
      throw usage();
    }

    if (values.profile !== undefined && values.profile !== "lite" && values.profile !== "strict") {
      throw usage();
    }

    return { command, path: argument, profile: values.profile };
  }

  if (command === "validate" && positionals.length === 1) {
    return { command };
  }

  if (
    command === "new" &&
    positionals.length === 2 &&
    argument?.trim() &&
    !argument.startsWith("--") &&
    !/[\r\n]/.test(argument)
  ) {
    return { command, title: argument };
  }

  throw usage();
}
