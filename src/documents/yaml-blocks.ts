import type { Code, Heading } from "mdast";
import { parseDocument } from "yaml";

import { plain, type LocatedNode, type SourcePosition } from "./markdown-nodes.ts";

export type YamlFence = Code & { position: SourcePosition };

interface MarkdownSection {
  section: string;
  heading?: Heading;
  blocks: YamlFence[];
  items: LocatedNode[];
}

// H4 and deeper headings remain inside the current subsection.
export function* markdownSections(nodes: readonly LocatedNode[]) {
  let group: MarkdownSection = { section: "", blocks: [], items: [] };
  for (const node of nodes) {
    if (node.type === "heading" && node.depth <= 3) {
      if (group.blocks.length || group.items.length) {
        yield group;
      }

      const section = node.depth === 3 ? group.section : node.depth === 2 ? plain(node) : "";
      group = { section, heading: node.depth === 3 ? node : undefined, blocks: [], items: [] };
    } else if (node.type === "code" && node.lang === "yaml") {
      group.blocks.push(node);
    } else if (node.type === "listItem") {
      group.items.push(node);
    }
  }

  if (group.blocks.length || group.items.length) {
    yield group;
  }
}

// Journal reads the Markdown code value. Spec also needs the final source newline
// for literal scalars and precise offsets for diagnostics and references.
export function parseYamlFence(block: YamlFence, markdown: string, content: "markdown" | "source") {
  const start = block.position.start.offset;
  const raw = markdown.slice(start, block.position.end.offset);
  const lines = raw.split(/\r?\n/);
  const open = /^(`+|~+)/.exec(lines[0])?.[1];
  const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(lines.at(-1)!);
  const closed = !!(open && lines.length > 1 && close && close[1].startsWith(open));
  const header = raw.indexOf("\n") + 1;
  const base = start + header;
  const fencedSource = raw.slice(header, closed ? raw.length - lines.at(-1)!.length : undefined);
  // CommonMark strips up to the opening fence's indentation on each line.
  const indent = block.position.start.column - 1;
  const removed: { at: number; total: number }[] = [];
  let total = 0;
  const yaml = indent
    ? fencedSource.replace(
        new RegExp("^ {1," + indent + "}", "gm"),
        (spaces: string, at: number) => {
          removed.push({ at: at - total, total: total + spaces.length });
          total += spaces.length;
          return "";
        },
      )
    : fencedSource;
  const position = (at: number) =>
    base + at + (removed.findLast((line) => line.at <= at)?.total ?? 0);
  const text = content === "markdown" ? block.value : yaml;

  return {
    text,
    document: parseDocument(text, { uniqueKeys: true, prettyErrors: content === "markdown" }),
    closed,
    offsetInMarkdown: position,
  };
}
