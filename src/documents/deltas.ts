import { isMap, isNode, isScalar } from "yaml";

import { deltaRules } from "../rules/delta.ts";
import { SourceDiagnostics } from "./diagnostics.ts";
import { activeMarkdownNodes, plain, textReferences, type LocatedNode } from "./markdown-nodes.ts";
import { addressIdentity } from "./schema.ts";
import type { DocumentSource, RequirementDelta, Reference } from "./types.ts";
import { markdownSections, parseYamlFence, type YamlFence } from "./yaml-blocks.ts";

// Markdown eligibility is determined on the decoded YAML string. Match bracket
// occurrences in order, including those in examples, to locate repeated links.
function revisionReferences(text: string, encoded: string, base: number): Reference[] {
  const refs = activeMarkdownNodes(text).flatMap((node) =>
    node.type === "text"
      ? textReferences(
          text.slice(node.position.start.offset, node.position.end.offset),
          node.position.start.offset,
        )
      : [],
  );

  let cursor = 0;
  const offsets = new Map<number, number>();
  for (const match of text.matchAll(/\[((?:change|srs|research|adr)-[^\]\r\n]*)\]/g)) {
    const at = encoded.indexOf(match[0], cursor);
    if (at >= 0) {
      offsets.set(match.index, base + at);
      cursor = at + match[0].length;
    }
  }

  // Escaped YAML spellings may have no literal bracket in the source.
  return refs.map((ref) => ({
    ...ref,
    offset: offsets.get(ref.offset) ?? base,
    key: "содержательная ссылка",
  }));
}

function readRequirementDelta(
  source: DocumentSource,
  block: YamlFence,
  local: string,
  diagnostics: SourceDiagnostics,
  references: Reference[],
): RequirementDelta | undefined {
  const start = block.position.start.offset;
  let valid = true;
  function warn(message: string, offset = start) {
    diagnostics.add(deltaRules.requirementDelta, local + ": " + message, offset);
    valid = false;
  }

  const {
    document: doc,
    text: yaml,
    offsetInMarkdown: position,
    closed,
  } = parseYamlFence(block, source.raw, "source");

  if (!closed) {
    warn("Закройте YAML-блок дельты.");
  }

  for (const error of [...doc.errors, ...doc.warnings]) {
    warn(error.message, position(error.pos[0]));
  }

  const map = doc.contents;
  if (!isMap(map)) {
    warn("Требуется YAML-отображение с полями дельты.");
    return;
  }

  const field = (key: string) => map.get(key, true);
  const offset = (key: string) => position(field(key)?.range?.[0] ?? 0);
  let targetCount = 0;
  for (const { key, value } of map.items) {
    const name = isScalar(key) ? key.value : undefined;
    if (name === "changes") {
      targetCount++;
    } else if (name !== "operation" && name !== "before" && name !== "after") {
      warn(
        "Неизвестное поле дельты: " + String(name),
        position(isNode(key) ? (key.range?.[0] ?? 0) : 0),
      );
    }

    if (
      (name === "before" || name === "after") &&
      isScalar(value) &&
      typeof value.value === "string" &&
      value.range
    ) {
      const [from, to] = value.range;
      for (const ref of revisionReferences(value.value, yaml.slice(from, to), from)) {
        references.push({ ...ref, offset: position(ref.offset) });
      }
    }
  }

  const stringField = (key: string, forbidden = false): string | undefined => {
    if (forbidden) {
      if (map.has(key)) {
        warn("Поле " + key + " недопустимо для этой операции.", offset(key));
      }

      return;
    }

    const node = field(key);
    const text: unknown = isScalar(node) ? node.value : undefined;
    if (typeof text === "string" && text.trim()) {
      return text;
    }

    warn("Поле " + key + " требует непустую строку.", offset(key));
  };

  const operation = stringField("operation");
  const target = stringField("changes");
  const targetOffset = offset("changes");
  if (target && targetCount === 1) {
    references.push({ value: target, offset: targetOffset, key: "Changes" });
  }

  const before = stringField("before", operation === "add");
  const after = stringField("after", operation === "remove");
  if (operation !== "add" && operation !== "modify" && operation !== "remove") {
    warn("Требуется operation со значением add, modify или remove.", offset("operation"));
    return;
  }

  const address = addressIdentity(target);
  if (!target || address?.type !== "srs" || !address.local?.startsWith("R-")) {
    warn("Поле changes требует адрес R в SRS.", targetOffset);
    return;
  }

  if (valid) {
    return { local, operation, target, offset: targetOffset, before, after };
  }
}

export function readRequirementDeltas(source: DocumentSource, nodes: readonly LocatedNode[]) {
  const diagnostics = new SourceDiagnostics(source);
  const value: RequirementDelta[] = [];
  const references: Reference[] = [];
  for (const { section, heading, blocks, items } of markdownSections(nodes)) {
    if (section !== "Requirements" || heading?.children[0]?.type !== "text") {
      continue;
    }

    const local = /^(R-[1-9]\d*):\s+\S/.exec(plain(heading))?.[1];
    if (!local) {
      continue;
    }

    for (const item of items) {
      const { start, end } = item.position;
      if (
        /^- (Operation|Changes|Before|After):(?:\s|$)/.test(
          source.raw.slice(start.offset, end.offset),
        )
      ) {
        diagnostics.add(
          deltaRules.requirementDelta,
          local + ": перенесите старые поля дельты в блок yaml.",
          start.offset,
        );
      }
    }

    for (const [i, block] of blocks.entries()) {
      if (i > 0) {
        diagnostics.add(
          deltaRules.requirementDelta,
          local + ": повторный YAML-блок дельты.",
          block.position.start.offset,
        );
      }

      const delta = readRequirementDelta(source, block, local, diagnostics, references);
      if (delta && blocks.length === 1) {
        value.push(delta);
      }
    }
  }

  return {
    value,
    references: references.sort((a, b) => a.offset - b.offset),
    diagnostics: diagnostics.items,
  };
}
