import { diagnostic } from "../diagnostics.ts";
import type { Diagnostic } from "../diagnostics.ts";
import type { Rule } from "../rules.ts";
import type { DocumentSource } from "./types.ts";

// A collector belongs to one parse/check, never to the document data.
export class SourceDiagnostics {
  readonly #source: DocumentSource;
  readonly #items: Diagnostic[] = [];

  constructor(source: DocumentSource) {
    this.#source = source;
  }

  add(rule: Rule, message: string, offset = 0): void {
    const prefix = this.#source.raw.slice(0, offset);
    this.#items.push(
      diagnostic(
        this.#source.file,
        rule,
        message,
        prefix.split("\n").length,
        offset - prefix.lastIndexOf("\n"),
      ),
    );
  }

  get items(): Diagnostic[] {
    return [...this.#items];
  }
}
