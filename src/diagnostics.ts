import { constants } from "node:os";

import type { Rule, RuleId } from "./rules.ts";

export type DiagnosticCode =
  | "E_UNSUPPORTED"
  | "E_IO"
  | "E_INTERNAL"
  | "E_CONFIG"
  | "E_USAGE"
  | "E_SCOPE"
  | "E_RUNTIME"
  | "E_EXISTS"
  | "E_ID_EXHAUSTED"
  | "E_YAML"
  | "E_ID"
  | "E_FIELD"
  | "W_FORM"
  | "W_ARCHIVE_REFERENCE"
  | "W_HISTORY"
  | "W_SYNC_PENDING"
  | "E_ARCHIVE_STATE"
  | "W_VERIFICATION_COVERAGE"
  | "E_PLAN_COVERAGE"
  | "E_STRUCTURE"
  | "E_DUPLICATE_LOCAL_ID"
  | "E_DRAFT_PLACEHOLDER"
  | "E_LOCATION"
  | "E_DUPLICATE_ID"
  | "E_REFERENCE_SYNTAX"
  | "E_REFERENCE_TARGET";

export type RuleGroup = Record<string, { id: string; code: DiagnosticCode }>;

export interface Diagnostic {
  ruleId?: RuleId;
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
  if (error instanceof AggregateError) {
    const errors: unknown[] = error.errors;
    return `${error.message}: ${errors.map(errorMessage).join("; ")}`;
  }

  return error instanceof Error ? error.message : String(error);
}

export class CommandError extends Error {
  readonly reason: DiagnosticCode | Rule;
  file: string;

  get code(): DiagnosticCode {
    return typeof this.reason === "string" ? this.reason : this.reason.code;
  }

  constructor(
    reason: DiagnosticCode | Rule,
    message: string,
    file = "viaferrata.toml",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.reason = reason;
    this.file = file;
  }
}

export function diagnostic(
  file: string,
  reason: DiagnosticCode | Rule,
  message: string,
  line = 1,
  column = 1,
): Diagnostic {
  const code = typeof reason === "string" ? reason : reason.code;
  return {
    ...(typeof reason === "string" ? {} : { ruleId: reason.id }),
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
        "E_INTERNAL",
        "E_IO",
        "E_CONFIG",
        "E_UNSUPPORTED",
        "E_USAGE",
        "E_RUNTIME",
        "E_EXISTS",
        "E_ID_EXHAUSTED",
      ].includes(d.code),
    )
  ) {
    return 2;
  }

  return items.some((d) => d.severity === "error") ? 1 : 0;
}

export function sortDiagnostics(items: Diagnostic[]) {
  return items.sort((a, b) =>
    a.file < b.file
      ? -1
      : a.file > b.file
        ? 1
        : a.line - b.line || a.column - b.column || a.code.localeCompare(b.code),
  );
}

export function formatDiagnostic(d: Diagnostic) {
  return `${d.file}:${d.line}:${d.column} ${d.code}:${d.ruleId ? ` [${d.ruleId}]` : ""} ${d.message}`;
}

const fileErrorCodes = new Set(Object.keys(constants.errno));
export function isFileError(error: unknown): boolean {
  if (error instanceof AggregateError) {
    const errors: unknown[] = error.errors;
    return errors.length > 0 && errors.every(isFileError);
  }

  return fileErrorCodes.has(errorCode(error) ?? "");
}

export function errorStack(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const nested: unknown[] = error instanceof AggregateError ? error.errors : [];
  if (error.cause !== undefined) {
    nested.push(error.cause);
  }

  return [error.stack ?? error.message, ...nested.map(errorStack)].join("\nCaused by: ");
}
