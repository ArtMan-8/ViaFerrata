import { parseDocument, visit, isAlias, isScalar, isSeq, isMap, isNode } from "yaml";

import type { DiagnosticCode } from "../diagnostics.ts";
import { errorMessage } from "../diagnostics.ts";
import { SourceDiagnostics } from "./diagnostics.ts";
import { identity, statuses, executions } from "./schema.ts";
import type { DocumentSource, DocumentMetadata, Reference, Result } from "./types.ts";

interface FrontMatter {
  start: number;
  nodeFor: (key: string) => ReturnType<typeof mappingNode>;
  field: (key: string, code: DiagnosticCode, message: string) => void;
  value: DocumentMetadata;
}

const fieldNames = new Set([
  "id",
  "status",
  "execution",
  "created",
  "updated",
  "scope",
  "origin",
  "research",
  "adr",
  "supersedes",
]);

function nonemptyStrings(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item: unknown) => typeof item === "string" && item.trim().length > 0)
  );
}

function mappingNode(yaml: ReturnType<typeof parseDocument>, key: string) {
  const node: unknown = yaml.get(key, true);
  return isNode(node) ? node : undefined;
}

function readFrontMatter(
  source: DocumentSource,
  diagnostics: SourceDiagnostics,
): FrontMatter | null {
  const { raw } = source;
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!match) {
    diagnostics.add(
      "E_YAML",
      "Нет закрытого YAML front matter в начале файла; добавьте строки --- и метаданные.",
    );

    return null;
  }

  const bodyOffset = match[0].length;
  const start = raw.indexOf("\n") + 1;
  const yaml = parseDocument(match[1], { version: "1.2", uniqueKeys: true });
  for (const error of yaml.errors) {
    diagnostics.add(
      "E_YAML",
      `${errorMessage(error)}; исправьте YAML.`,
      start + (error.pos?.[0] ?? 0),
    );
  }

  if (yaml.errors.length) {
    return null;
  }

  let unsupported = false;
  visit(yaml, (key, node) => {
    if (
      isAlias(node) ||
      ((isScalar(node) || isMap(node) || isSeq(node)) &&
        (node.anchor || (node.tag && !node.tag.startsWith("tag:yaml.org,2002:")))) ||
      (key === "key" && isScalar(node) && node.value === "<<")
    ) {
      unsupported = true;
    }
  });

  if (unsupported || yaml.warnings.length || yaml.directives.yaml.version !== "1.2") {
    diagnostics.add(
      "E_UNSUPPORTED",
      "Требуется YAML 1.2 без tags, anchors, aliases и merge keys; запишите обычные значения.",
      start,
    );

    return null;
  }

  if (!isMap(yaml.contents)) {
    diagnostics.add(
      "E_YAML",
      "Front matter должен быть mapping; используйте поля key: value.",
      start,
    );

    return null;
  }

  // A YAML mapping produces an object; its values remain unknown until checked.
  const fields = yaml.toJS() as Record<string, unknown>;
  const documentIdentity = identity(fields.id);
  const nodeFor = (key: string) => mappingNode(yaml, key);
  const offsetFor = (key: string) => start + (nodeFor(key)?.range?.[0] ?? 0);
  const field = (key: string, code: DiagnosticCode, message: string) =>
    diagnostics.add(code, message, offsetFor(key));
  if (!documentIdentity) {
    field(
      "id",
      "E_ID",
      "id отсутствует или не соответствует формату ViaFerrata; задайте полный ID.",
    );

    return null;
  }

  return {
    start,
    nodeFor,
    field,
    value: { identity: documentIdentity, fields, bodyOffset, references: [] },
  };
}

export function readDocumentIdentity(source: DocumentSource): Result<DocumentMetadata | null> {
  const diagnostics = new SourceDiagnostics(source);
  const front = readFrontMatter(source, diagnostics);
  return { value: front?.value ?? null, diagnostics: diagnostics.items };
}

export function parseDocumentMetadata(source: DocumentSource): Result<DocumentMetadata | null> {
  const diagnostics = new SourceDiagnostics(source);
  const front = readFrontMatter(source, diagnostics);
  if (!front) {
    return { value: null, diagnostics: diagnostics.items };
  }

  const { start, field, nodeFor } = front;
  const references: Reference[] = [];
  const { type } = front.value.identity;
  for (const key of Object.keys(front.value.fields)) {
    if (["type", "kind", "change_id"].includes(key)) {
      field(key, "E_FIELD", `${key} запрещён; тип и change определяются из id.`);
    } else if (!fieldNames.has(key)) {
      field(
        key,
        "W_UNKNOWN_FIELD",
        `Неизвестное поле ${key}: сохранено, не интерпретировано; проверьте назначение или написание.`,
      );
    }
  }

  for (const key of ["created", "updated"]) {
    const value = front.value.fields[key];
    const node = nodeFor(key);
    const valid =
      typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      isScalar(node) &&
      (node.type === "QUOTE_DOUBLE" || node.type === "QUOTE_SINGLE") &&
      !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!valid) {
      field(key, "E_DATE", `${key} должен содержать реальную дату YYYY-MM-DD в кавычках.`);
    }
  }

  if (
    typeof front.value.fields.updated === "string" &&
    typeof front.value.fields.created === "string" &&
    front.value.fields.updated < front.value.fields.created
  ) {
    field("updated", "E_DATE", "updated раньше created; исправьте дату.");
  }

  for (const key of ["status", "execution"]) {
    const required = key === "status" ? type !== "journal" : type === "plan";
    const value = front.value.fields[key];
    if (!required && value !== undefined) {
      field(key, "E_FIELD", `${key} не разрешён для ${type}; удалите поле.`);
    }

    if (required && typeof value !== "string") {
      field(key, "E_FIELD", `Требуется строковое поле ${key}.`);
    } else if (required && typeof value === "string") {
      const values =
        key === "execution"
          ? executions
          : type === "research"
            ? ["draft", "completed", "superseded", "cancelled"]
            : statuses;
      if (!values.includes(value)) {
        field(key, "E_ENUM", `${key}: допустимо ${values.join(", ")}.`);
      }
    }
  }

  for (const key of ["scope", "origin", "research", "adr", "supersedes"]) {
    if (!(key in front.value.fields)) {
      continue;
    }

    if (key === "scope" && type !== "spec") {
      field(key, "E_FIELD", "scope разрешён только в задачной Spec.");
    }

    if (key === "supersedes" && !["intent", "research", "adr"].includes(type)) {
      field(key, "E_UNSUPPORTED", `supersedes для ${type} не поддерживается.`);
    }

    const node = nodeFor(key);
    const values = front.value.fields[key];
    if (!isSeq(node) || !nonemptyStrings(values) || (key !== "scope" && node.flow)) {
      field(
        key,
        "E_FIELD",
        `${key} должен быть непустым массивом строк${key === "scope" ? "" : " через дефисы"}; исправьте форму.`,
      );

      continue;
    }

    if (key !== "scope") {
      values.forEach((value, i) =>
        references.push({
          value,
          key,
          offset: start + (isNode(node.items[i]) ? (node.items[i].range?.[0] ?? 0) : 0),
        }),
      );
    }
  }

  return {
    value: { ...front.value, references },
    diagnostics: diagnostics.items,
  };
}
