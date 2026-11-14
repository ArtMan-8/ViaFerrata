import type { Nodes } from "mdast";
import remarkParse from "remark-parse";
import { unified } from "unified";
import type { Point, Position } from "unist";

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

export function plain(node: Nodes): string {
  return "value" in node ? node.value : "children" in node ? node.children.map(plain).join("") : "";
}

export function activeMarkdownNodes(source: string): LocatedNode[] {
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

  function visitNode(node: Nodes) {
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

    if (ignored.has(node.type)) {
      return;
    }

    if (!htmlStack.length && ["heading", "listItem", "paragraph", "text"].includes(node.type)) {
      assertPosition(node);
      events.push(node);
    }

    for (const child of "children" in node ? node.children : []) {
      visitNode(child);
    }
  }

  visitNode(tree);
  events.sort((a, b) => a.position.start.offset - b.position.start.offset);
  return events;
}
