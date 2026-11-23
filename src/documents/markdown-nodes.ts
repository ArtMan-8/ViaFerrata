import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Point, Position } from "unist";

import type { Reference } from "./types.ts";

export type SourcePosition = Position & {
  start: Point & { offset: number };
  end: Point & { offset: number };
};

export type LocatedNode = Nodes & { position: SourcePosition };

// remark-parse supplies offsets; verify this boundary before relying on them.
function assertPosition(node: Nodes): asserts node is LocatedNode {
  if (node.position?.start.offset === undefined || node.position.end.offset === undefined) {
    throw new Error("Markdown parser did not provide source offsets");
  }
}

const parser = unified().use(remarkParse);

const ignored = new Set([
  "code",
  "inlineCode",
  "html",
  "blockquote",
  "definition",
  "link",
  "linkReference",
  "image",
  "imageReference",
]);

export function topLevelMarkdownNodes(source: string): LocatedNode[] {
  return parser.parse(source).children.map((node) => {
    assertPosition(node);
    return node;
  });
}

export function plain(node: Nodes): string {
  return "value" in node ? node.value : "children" in node ? node.children.map(plain).join("") : "";
}

export function activeMarkdownNodes(source: string, sectionNodes?: LocatedNode[]): LocatedNode[] {
  const tree = parser.parse(source);
  const events: LocatedNode[] = [];
  const htmlStack: string[] = [];
  const voidTags = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);

  function visitNode(node: Nodes, depth: number) {
    if (node.type === "html") {
      const html = node.value.replace(/<!--[\s\S]*?-->/g, "");
      for (const tag of html.matchAll(/<(\/?)([a-z][\w-]*)\b[^>]*?(\/?)>/gi)) {
        const name = tag[2].toLowerCase();
        if (tag[1]) {
          const index = htmlStack.lastIndexOf(name);
          if (index >= 0) {
            htmlStack.splice(index);
          }
        } else if (!tag[3] && !voidTags.has(name)) {
          htmlStack.push(name);
        }
      }

      return;
    }

    if (
      sectionNodes &&
      !htmlStack.length &&
      ((depth === 1 &&
        (node.type === "heading" || (node.type === "code" && node.lang === "yaml"))) ||
        (depth === 2 && node.type === "listItem"))
    ) {
      assertPosition(node);
      sectionNodes.push(node);
    }

    if (ignored.has(node.type)) {
      return;
    }

    if (!htmlStack.length && ["heading", "listItem", "paragraph", "text"].includes(node.type)) {
      assertPosition(node);
      events.push(node);
    }

    for (const child of "children" in node ? node.children : []) {
      visitNode(child, depth + 1);
    }
  }

  visitNode(tree, 0);
  events.sort((a, b) => a.position.start.offset - b.position.start.offset);
  return events;
}

export function textReferences(rawText: string, offset: number): Reference[] {
  const references: Reference[] = [];
  const brackets = /\[((?:change|srs|research|adr)-[^\]\r\n]*)\]/g;
  for (const m of rawText.matchAll(brackets)) {
    let backslashes = 0;
    for (let i = m.index - 1; i >= 0 && rawText[i] === "\\"; i--) {
      backslashes++;
    }

    if (backslashes % 2) {
      continue;
    }

    references.push({ value: m[1], offset: offset + m.index });
  }

  return references;
}
