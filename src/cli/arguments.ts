import { parseArgs } from "node:util";

import { CommandError, errorCode } from "../diagnostics.ts";
import { addressIdentity } from "../documents/schema.ts";

export type DraftType = (typeof draftTypes)[number];

export type Arguments =
  | { command: "complete"; change: string }
  | { command: "help" }
  | { command: "version" }
  | { command: "validate" }
  | { command: "scope"; change: string; digest: boolean }
  | { command: "summary"; change: string | null }
  | { command: "init"; path?: string; documentsRoot?: string; profile?: "lite" | "strict" }
  | { command: "new"; type: DraftType; title: string };

const draftTypes = ["change", "srs", "adr", "research"] as const;
const usageForms = {
  init: ["vf init [path] [--profile lite|strict] [--documents-root <path>]"],
  new: draftTypes.map((type) => `vf new ${type} "Название"`),
  validate: ["vf validate"],
  summary: ["vf summary change-NNNNNN", "vf summary --stdin"],
  scope: ["vf scope change-NNNNNN [--digest]"],
  complete: ["vf complete change-NNNNNN"],
};

export const commandHelp = Object.values(usageForms).flat().join("\n");

function usageError([command, argument]: string[]) {
  if (!command || !Object.hasOwn(usageForms, command)) {
    return new CommandError(
      "E_CLI_SYNTAX",
      "Неверная команда или глобальная опция; см. vf --help.",
      "vf",
    );
  }

  const type =
    command === "new" ? draftTypes.find((candidate) => candidate === argument) : undefined;
  const forms = type
    ? [`vf new ${type} "Название"`]
    : usageForms[command as keyof typeof usageForms];

  return new CommandError("E_CLI_COMMAND_USAGE", `Используйте ${forms.join(" или ")}.`, "vf");
}

export function argumentsFor(argv: string[]): Arguments {
  const options = {
    help: { type: "boolean" },
    version: { type: "boolean" },
    profile: { type: "string" },
    "documents-root": { type: "string" },
    digest: { type: "boolean" },
    stdin: { type: "boolean" },
  } as const;
  const globalInvocation = argv[0] === "--help" || argv[0] === "--version";
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options,
      allowPositionals: true,
      strict: true,
      tokens: true,
    });
  } catch (error) {
    if (errorCode(error)?.startsWith("ERR_PARSE_ARGS_")) {
      // Recover positionals only to choose a hint. Strict parsing rejected this invocation.
      const { positionals } = parseArgs({
        args: argv,
        options,
        allowPositionals: true,
        strict: false,
      });
      throw usageError(globalInvocation ? [] : positionals);
    }

    throw error;
  }

  const usage = () => usageError(globalInvocation ? [] : parsed.positionals);
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

  const documentsRoot = values["documents-root"];
  if ((values.profile !== undefined || documentsRoot !== undefined) && command !== "init") {
    throw usage();
  }

  if (command === "scope") {
    if (
      positionals.length !== 2 ||
      !argument ||
      !addressIdentity(argument)?.bundle ||
      values.stdin
    ) {
      throw usage();
    }

    return { command, change: argument, digest: !!values.digest };
  }

  if (values.digest) {
    throw usage();
  }

  if (command === "summary") {
    if (values.stdin && positionals.length === 1) {
      return { command, change: null };
    }

    if (
      !values.stdin &&
      positionals.length === 2 &&
      argument &&
      addressIdentity(argument)?.bundle
    ) {
      return { command, change: argument };
    }

    throw usage();
  }

  if (values.stdin) {
    throw usage();
  }

  if (command === "init" && positionals.length <= 2) {
    if (argument !== undefined && (!argument.trim() || argument.startsWith("--"))) {
      throw usage();
    }

    if (values.profile !== undefined && values.profile !== "lite" && values.profile !== "strict") {
      throw usage();
    }

    return { command, path: argument, profile: values.profile, documentsRoot };
  }

  if (
    command === "complete" &&
    positionals.length === 2 &&
    argument &&
    addressIdentity(argument)?.bundle
  ) {
    return { command, change: argument };
  }

  if (command === "validate" && positionals.length === 1) {
    return { command };
  }

  if (command === "new") {
    const type = draftTypes.find((candidate) => candidate === argument);
    const title = positionals[2];
    if (
      positionals.length === 3 &&
      type &&
      title?.trim() &&
      !title.startsWith("--") &&
      !/[\r\n]/.test(title)
    ) {
      return { command, type, title };
    }
  }

  throw usage();
}
