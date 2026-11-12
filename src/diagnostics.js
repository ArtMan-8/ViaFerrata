export class CommandError extends Error {
  constructor(code, message, file = "viaferrata.toml") {
    super(message);
    this.code = code;
    this.file = file;
  }
}

export function diagnostic(file, code, message, line = 1, column = 1) {
  return {
    file,
    code,
    message,
    line,
    column,
    severity: code.startsWith("W_") ? "warning" : "error",
  };
}

export function exitCode(items) {
  if (
    items.some((d) =>
      [
        "E_IO",
        "E_CONFIG",
        "E_UNSUPPORTED",
        "E_USAGE",
        "E_RUNTIME",
        "E_EXISTS",
        "E_ID_EXHAUSTED",
      ].includes(d.code),
    )
  )
    return 2;
  return items.some((d) => d.severity === "error") ? 1 : 0;
}

export function sortDiagnostics(items) {
  return items.sort((a, b) =>
    a.file < b.file
      ? -1
      : a.file > b.file
        ? 1
        : a.line - b.line ||
          a.column - b.column ||
          a.code.localeCompare(b.code),
  );
}

export function formatDiagnostic(d) {
  return `${d.file}:${d.line}:${d.column} ${d.code}: ${d.message}`;
}
