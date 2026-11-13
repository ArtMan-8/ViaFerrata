import { CommandError } from "../diagnostics.ts";

export type Arguments =
  | { command: "help" }
  | { command: "version" }
  | { command: "validate"; root: string }
  | { command: "init"; root: string; profile?: "lite" | "strict" }
  | { command: "new"; root: string; title: string };

export function argumentsFor(argv: string[]): Arguments {
  if (!argv.length || (argv.length === 1 && argv[0] === "--help"))
    return { command: "help" };
  if (argv.length === 1 && argv[0] === "--version")
    return { command: "version" };
  const args = [...argv];
  let root = process.cwd();
  if (args[0] === "--root") {
    args.shift();
    const rootArgument = args.shift();
    if (!rootArgument || rootArgument.startsWith("--"))
      throw new CommandError(
        "E_USAGE",
        "Укажите путь после --root; см. vf --help.",
        "vf",
      );
    root = rootArgument;
  }
  const [command, title] = args;
  if (command === "init") {
    if (args.length === 1) return { command, root };
    if (
      args.length === 3 &&
      title === "--profile" &&
      (args[2] === "lite" || args[2] === "strict")
    )
      return { command, root, profile: args[2] };
  }
  if (command === "validate" && args.length === 1) return { command, root };
  if (
    command === "new" &&
    args.length === 2 &&
    !title.startsWith("--") &&
    title.trim() &&
    !/[\r\n]/.test(title)
  )
    return { command, root, title };
  throw new CommandError(
    "E_USAGE",
    "Неверная команда, флаг или аргументы; см. vf --help.",
    "vf",
  );
}
