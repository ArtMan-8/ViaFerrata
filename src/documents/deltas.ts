import { deltaRules } from "../rules/delta.ts";
import { SourceDiagnostics } from "./diagnostics.ts";
import { activeMarkdownNodes, plain } from "./markdown-nodes.ts";
import { addressIdentity } from "./schema.ts";
import type { DocumentSource, RequirementDelta, Reference, Result } from "./types.ts";

// Parse only active list fields in a requirement; examples and quotations are excluded.
export function parseDeltas(
  source: DocumentSource,
  bodyOffset: number,
): Result<RequirementDelta[]> {
  const diagnostics = new SourceDiagnostics(source);
  const deltas: RequirementDelta[] = [];
  const masked =
    source.raw.slice(0, bodyOffset).replace(/[^\r\n]/g, " ") + source.raw.slice(bodyOffset);
  const events = activeMarkdownNodes(masked);
  const headings = events.filter((node) => node.type === "heading");
  for (const heading of headings) {
    if (heading.depth !== 3 || !/^R-[1-9]\d*:/.test(plain(heading))) {
      continue;
    }

    const section = headings
      .filter(
        (node) => node.depth === 2 && node.position.start.offset < heading.position.start.offset,
      )
      .at(-1);
    if (!section || plain(section) !== "Requirements") {
      continue;
    }

    const start = heading.position.end.offset;
    const end =
      headings.find((node) => node.position.start.offset > start && node.depth <= 3)?.position.start
        .offset ?? masked.length;
    const items = events.filter(
      (node) =>
        node.type === "listItem" &&
        node.position.start.offset > start &&
        node.position.end.offset <= end &&
        !events.some(
          (parent) =>
            parent.type === "listItem" &&
            parent.position.start.offset < node.position.start.offset &&
            parent.position.end.offset >= node.position.end.offset,
        ),
    );
    const fields = new Map<string, { text: string; offset: number }[]>();
    for (const item of items) {
      const raw = masked.slice(item.position.start.offset, item.position.end.offset);
      const match = /^- (Operation|Changes|Before|After):(?:\s|$)([\s\S]*)$/.exec(raw);

      if (!match) {
        continue;
      }

      const values = fields.get(match[1]) ?? [];
      values.push({ text: match[2].trim(), offset: item.position.start.offset });
      fields.set(match[1], values);
    }

    if (!fields.size) {
      continue;
    }

    const operation = fields.get("Operation")?.[0]?.text;
    const changes = fields.get("Changes")?.[0];
    const match = changes && /^- \[((?:srs)-\d{6}\/R-[1-9]\d*)\]$/.exec(changes.text);
    const before = fields.get("Before")?.[0]?.text;
    const after = fields.get("After")?.[0]?.text;
    if (
      [...fields.values()].some((values) => values.length !== 1) ||
      !["add", "modify", "remove"].includes(operation ?? "") ||
      !match ||
      !addressIdentity(match[1]) ||
      (operation === "add" ? fields.has("Before") || !after : !before) ||
      (operation === "remove" ? fields.has("After") : !after)
    ) {
      diagnostics.add(
        deltaRules.requirementDelta,
        "Дельта требует одну Operation add/modify/remove, один Changes к R SRS и полный Before/After по операции.",
        heading.position.start.offset,
      );

      continue;
    }

    deltas.push({
      local: plain(heading).split(":")[0],
      operation: operation as RequirementDelta["operation"],
      target: match[1],
      offset: masked.indexOf(`[${match[1]}]`, changes!.offset),
      before,
      after,
    });
  }

  return { value: deltas, diagnostics: diagnostics.items };
}

export function referencePurpose(raw: string, reference: Reference): string {
  if (reference.key) {
    return reference.key;
  }

  const events = activeMarkdownNodes(raw);
  const parent = events
    .filter(
      (node) =>
        node.type === "listItem" &&
        node.position.start.offset <= reference.offset &&
        node.position.end.offset > reference.offset,
    )
    .find((node) => /^(Covers|Verifies|Changes|Depends on):/.test(plain(node)));
  return parent ? plain(parent).split(":")[0] : "содержательная ссылка";
}
