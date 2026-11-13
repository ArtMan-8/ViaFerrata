import type { Category } from "../config.ts";
import type { Diagnostic } from "../diagnostics.ts";

export type DocumentType =
  "intent" | "spec" | "plan" | "journal" | "srs" | "research" | "adr";
export type LocalType = "AC" | "R" | "S" | "DOD" | "W" | "P" | "V";
export interface DocumentIdentity {
  id: string;
  type: DocumentType;
  change: string | null;
}
export type AddressIdentity =
  | { bundle: string; document?: never; type?: never; local?: never }
  | { document: string; type: DocumentType; local?: string; bundle?: never };

export interface Result<T> {
  value: T;
  diagnostics: Diagnostic[];
}
export interface DocumentSource {
  readonly file: string;
  readonly raw: string;
}
export interface DocumentFile {
  readonly absolute: string;
  readonly file: string;
  readonly category: Category;
}
export interface ReadDocument extends DocumentFile, DocumentSource {}
export interface Reference {
  readonly value: string;
  readonly offset: number;
  readonly key?: string;
}
export interface DocumentMetadata {
  readonly identity: DocumentIdentity;
  readonly fields: Readonly<Record<string, unknown>>;
  readonly bodyOffset: number;
  readonly references: readonly Reference[];
}
export interface DocumentBody {
  readonly locals: ReadonlySet<string>;
  readonly references: readonly Reference[];
}
export interface IndexedDocument extends ReadDocument {
  // Invalid documents remain in the result, together with their diagnostics.
  readonly metadata: DocumentMetadata | null;
}
export interface ParsedDocument extends IndexedDocument {
  readonly body: DocumentBody | null;
}
export interface DocumentIndex<T extends IndexedDocument = IndexedDocument> {
  readonly documents: ReadonlyMap<string, T>;
  readonly bundles: ReadonlyMap<string, ReadonlyMap<DocumentType, T>>;
}
