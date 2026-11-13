export type DiagnosticCode =
  | "E_UNSUPPORTED"
  | "E_IO"
  | "E_CONFIG"
  | "E_USAGE"
  | "E_RUNTIME"
  | "E_EXISTS"
  | "E_ID_EXHAUSTED"
  | "E_YAML"
  | "E_ID"
  | "E_FIELD"
  | "W_UNKNOWN_FIELD"
  | "E_DATE"
  | "E_ENUM"
  | "E_STRUCTURE"
  | "E_DUPLICATE_LOCAL_ID"
  | "E_DRAFT_PLACEHOLDER"
  | "E_LOCATION"
  | "E_DUPLICATE_ID"
  | "E_REFERENCE_SYNTAX"
  | "E_REFERENCE_TARGET";

export interface Diagnostic {
  file: string;
  code: DiagnosticCode;
  message: string;
  line: number;
  column: number;
  severity: "warning" | "error";
}

export function errorCode(error: unknown): string | undefined {
  return error !== null &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class CommandError extends Error {
  code: DiagnosticCode;
  file: string;

  constructor(code: DiagnosticCode, message: string, file = "viaferrata.toml") {
    super(message);
    this.code = code;
    this.file = file;
  }
}

export function diagnostic(
  file: string,
  code: DiagnosticCode,
  message: string,
  line = 1,
  column = 1,
): Diagnostic {
  return {
    file,
    code,
    message,
    line,
    column,
    severity: code.startsWith("W_") ? "warning" : "error",
  };
}

export function exitCode(items: readonly Diagnostic[]): 0 | 1 | 2 {
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

export function sortDiagnostics(items: Diagnostic[]) {
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

export function formatDiagnostic(d: Diagnostic) {
  return `${d.file}:${d.line}:${d.column} ${d.code}: ${d.message}`;
}
