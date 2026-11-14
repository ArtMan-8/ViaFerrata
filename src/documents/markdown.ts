import type { Heading } from "mdast";

import { SourceDiagnostics } from "./diagnostics.ts";
import {
  activeMarkdownNodes,
  plain,
  type SourcePosition,
  type LocatedNode,
} from "./markdown-nodes.ts";
import { requiredHeadings, localTypes } from "./schema.ts";
import type {
  LocalType,
  DocumentSource,
  DocumentMetadata,
  DocumentBody,
  Reference,
  Result,
} from "./types.ts";

interface Wave {
  node: Heading & { position: SourcePosition };
  count: number;
  execution: string[];
}

const expectedSection: Record<LocalType, string> = {
  AC: "Acceptance Criteria",
  R: "Requirements",
  S: "Scenarios",
  DOD: "Definition of Done",
  W: "Steps",
  P: "Steps",
  V: "Verification and Result",
};

export function parseDocumentBody(
  input: DocumentSource,
  metadata: DocumentMetadata,
): Result<DocumentBody> {
  const diagnostics = new SourceDiagnostics(input);
  const documentType = metadata.identity.type;
  const locals = new Set<string>();
  const references: Reference[] = [];

  const source =
    input.raw.slice(0, metadata.bodyOffset).replace(/[^\r\n]/g, " ") +
    input.raw.slice(metadata.bodyOffset);
  const events = activeMarkdownNodes(source);
  const headings = events.filter((n) => n.type === "heading");
  const h1 = headings.filter((n) => n.depth === 1);
  if (h1.length !== 1 || !plain(h1[0]).trim()) {
    diagnostics.add("E_STRUCTURE", "Требуется один непустой H1; исправьте заголовок.");
  }

  for (const name of requiredHeadings[documentType]) {
    if (headings.filter((n) => n.depth === 2 && plain(n) === name).length !== 1) {
      diagnostics.add(
        "E_STRUCTURE",
        `Требуется один H2 ${name}; добавьте раздел или удалите дубликат.`,
      );
    }
  }

  let section = "";
  let subsection = "";
  let wave: Wave | null = null;
  const waves: Wave[] = [];
  const ac: { node: Heading & { position: SourcePosition }; id: string }[] = [];
  function declare(id: string, node: LocatedNode, group: LocalType) {
    if (locals.has(id)) {
      diagnostics.add(
        "E_DUPLICATE_LOCAL_ID",
        `Повтор ${id}; сохраните уникальные локальные ID.`,
        node.position.start.offset,
      );
    } else {
      locals.add(id);
    }

    if (!localTypes[documentType].includes(group) || expectedSection[group] !== section) {
      diagnostics.add(
        "E_STRUCTURE",
        `${id} недопустим в этом типе/разделе; перенесите объявление.`,
        node.position.start.offset,
      );
    }
  }

  for (const node of events) {
    const offset = node.position.start.offset;
    if (node.type === "heading") {
      const title = plain(node);
      if (node.depth === 2) {
        section = title;
        subsection = "";
        wave = null;
      }

      if (node.depth === 3) {
        subsection = title;
      }

      // An ID presented entirely as inline code is an example, not a declaration.
      const first = node.children?.[0];
      if (first?.type !== "text" || !/^(AC|R|S|DOD|W|P|V)-/.test(first.value)) {
        continue;
      }

      const m = /^(AC|R|S|DOD|W|P|V)-([1-9]\d*):\s+\S/.exec(title);
      if (!m || node.depth !== (m[1] === "V" ? 4 : 3) || m[1] === "P") {
        diagnostics.add(
          "E_STRUCTURE",
          "Некорректное локальное объявление; исправьте ID, уровень или название.",
          offset,
        );

        continue;
      }

      // The declaration regex limits the capture to LocalType.
      const group = m[1] as LocalType;
      const id = `${group}-${m[2]}`;
      declare(id, node, group);
      if (group === "V" && subsection !== "Verification") {
        diagnostics.add("E_STRUCTURE", "V должен находиться в подразделе Verification.", offset);
      }

      if (group === "AC") {
        ac.push({ node, id });
      }

      if (group === "W") {
        wave = { node, count: 0, execution: [] };
        waves.push(wave);
      }
    }

    if (node.type === "listItem") {
      const firstLine = source.slice(offset, node.position.end.offset).split(/\r?\n/)[0];
      if (/^- \[[ x]\] P-/.test(firstLine)) {
        const m = /^- \[[ x]\] (P-[1-9]\d*):\s+\S/.exec(firstLine);
        if (!m) {
          diagnostics.add(
            "E_STRUCTURE",
            "Некорректный P-ID или пустой шаг; исправьте объявление.",
            offset,
          );
        } else {
          declare(m[1], node, "P");
          if (!wave) {
            diagnostics.add(
              "E_STRUCTURE",
              "Шаг должен находиться в волне W; добавьте волну.",
              offset,
            );
          } else {
            wave.count++;
          }
        }
      } else if (/^(?:[-+*]|\d+[.)])\s+(?:\[[^\]]*\]\s+)?P-/.test(firstLine)) {
        diagnostics.add(
          "E_STRUCTURE",
          "Шаг объявляется как - [ ] P-N: текст или - [x] P-N: текст.",
          offset,
        );
      }
    }

    if (node.type === "paragraph" && wave && plain(node).startsWith("Execution:")) {
      wave.execution.push(plain(node));
    }

    if (node.type !== "text") {
      continue;
    }

    // Use source ranges so escaped brackets remain distinguishable from real links.
    const rawText = source.slice(offset, node.position.end.offset);
    if (node.value.includes("TODO(VF)")) {
      diagnostics.add(
        "E_DRAFT_PLACEHOLDER",
        "Осталась заготовка TODO(VF); заполните или удалите неприменимый блок.",
        offset,
      );
    }

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
  }

  if (documentType === "intent") {
    if (!ac.length) {
      diagnostics.add("E_STRUCTURE", "Требуется хотя бы один AC с Verification.");
    }

    for (const item of ac) {
      const end =
        headings.find(
          (n) => n.position.start.offset > item.node.position.start.offset && n.depth <= 3,
        )?.position.start.offset ?? source.length;

      const hasVerification = events.some(
        (n) =>
          n.type === "listItem" &&
          n.position.start.offset > item.node.position.start.offset &&
          n.position.start.offset < end &&
          /^- Verification:\s+\S/.test(
            source.slice(n.position.start.offset, n.position.end.offset),
          ),
      );
      if (!hasVerification) {
        diagnostics.add(
          "E_STRUCTURE",
          `${item.id} требует непустой Verification; укажите способ проверки.`,
          item.node.position.start.offset,
        );
      }
    }
  }

  if (documentType === "srs" && ![...locals].some((id) => id.startsWith("R-"))) {
    diagnostics.add("E_STRUCTURE", "SRS требует хотя бы одно R; добавьте требование.");
  }

  if (documentType === "plan") {
    if (!waves.length) {
      diagnostics.add("E_STRUCTURE", "Plan требует хотя бы одну волну W.");
    }

    for (const w of waves) {
      if (
        !w.count ||
        w.execution.length !== 1 ||
        !["Execution: sequential", "Execution: parallel"].includes(w.execution[0])
      ) {
        diagnostics.add(
          "E_STRUCTURE",
          "Каждая волна требует Execution: sequential/parallel и хотя бы один шаг.",
          w.node.position.start.offset,
        );
      }
    }
  }

  return { value: { locals, references }, diagnostics: diagnostics.items };
}
