import type { Heading } from "mdast";

import { identityRules } from "../rules/identity.ts";
import { structureRules } from "../rules/structure.ts";
import { readRequirementDeltas } from "./deltas.ts";
import { SourceDiagnostics } from "./diagnostics.ts";
import {
  activeMarkdownNodes,
  textReferences,
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
  const sectionNodes: LocatedNode[] = [];
  const events = activeMarkdownNodes(source, documentType === "spec" ? sectionNodes : undefined);
  const headings = events.filter((n) => n.type === "heading");
  const h1 = headings.filter((n) => n.depth === 1);
  if (h1.length !== 1 || !plain(h1[0]).trim()) {
    diagnostics.add(
      structureRules.documentTitle,
      "Требуется один непустой H1; исправьте заголовок.",
    );
  }

  for (const name of requiredHeadings[documentType]) {
    if (headings.filter((n) => n.depth === 2 && plain(n) === name).length !== 1) {
      diagnostics.add(
        structureRules.requiredSections,
        `Требуется один H2 ${name}; добавьте раздел или удалите дубликат.`,
      );
    }
  }

  if (documentType === "adr") {
    const outcome = headings.find((node) => node.depth === 2 && plain(node) === "Decision Outcome");
    const end =
      headings.find(
        (node) =>
          node.depth <= 2 &&
          node.position.start.offset > (outcome?.position.start.offset ?? Infinity),
      )?.position.start.offset ?? source.length;

    for (const name of ["Consequences", "Confirmation"]) {
      if (
        !outcome ||
        headings.filter(
          (node) =>
            node.depth === 3 &&
            plain(node) === name &&
            node.position.start.offset > outcome.position.end.offset &&
            node.position.start.offset < end,
        ).length !== 1
      ) {
        diagnostics.add(
          structureRules.requiredSections,
          `Требуется один H3 ${name} внутри Decision Outcome.`,
        );
      }
    }
  }

  let section = "";
  let subsection = "";
  let wave: Wave | null = null;
  const covers = new Map<string, Set<string>>();
  const coverFields: { owner: string; start: number; end: number }[] = [];
  let currentAC: string | null = null;
  let stepEnd = -1;
  let currentStep: string | null = null;
  const waves: Wave[] = [];
  const ac: { node: Heading & { position: SourcePosition }; id: string }[] = [];
  function declare(id: string, node: LocatedNode, group: LocalType) {
    if (locals.has(id)) {
      diagnostics.add(
        identityRules.uniqueLocalId,
        `Повтор ${id}; сохраните уникальные локальные ID.`,
        node.position.start.offset,
      );
    } else {
      locals.add(id);
    }

    if (!localTypes[documentType].includes(group) || expectedSection[group] !== section) {
      diagnostics.add(
        structureRules.localDeclarationLocation,
        `${id} недопустим в этом типе/разделе; перенесите объявление.`,
        node.position.start.offset,
      );
    }
  }

  for (const node of events) {
    const offset = node.position.start.offset;
    if (node.type === "heading") {
      const title = plain(node);
      if (node.depth <= 3) {
        currentAC = null;
        currentStep = null;
      }

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
          structureRules.localHeading,
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
        diagnostics.add(
          structureRules.localDeclarationLocation,
          "V должен находиться в подразделе Verification.",
          offset,
        );
      }

      if (group === "AC") {
        ac.push({ node, id });
        if (section === "Acceptance Criteria") {
          currentAC = id;
        }
      }

      if (group === "W") {
        wave = { node, count: 0, execution: [] };
        waves.push(wave);
      }
    }

    if (node.type === "listItem") {
      const firstLine = source.slice(offset, node.position.end.offset).split(/\r?\n/)[0];
      if (/^- Covers:\s*$/.test(firstLine)) {
        const owner =
          documentType === "intent"
            ? currentAC
            : currentStep && offset < stepEnd
              ? currentStep
              : null;

        if (owner) {
          const parent = events
            .filter(
              (n) =>
                n.type === "listItem" &&
                n.position.start.offset < offset &&
                n.position.end.offset >= node.position.end.offset,
            )
            .at(-1);

          if (
            documentType === "intent"
              ? !parent
              : parent &&
                parent.position.end.offset === stepEnd &&
                /^- \[[ x]\] P-/.test(source.slice(parent.position.start.offset))
          ) {
            coverFields.push({ owner, start: offset, end: node.position.end.offset });
          }
        }
      }

      if (/^- \[[ x]\] P-/.test(firstLine)) {
        const m = /^- \[[ x]\] (P-[1-9]\d*):\s+\S/.exec(firstLine);
        if (!m) {
          diagnostics.add(
            structureRules.stepDeclaration,
            "Некорректный P-ID или пустой шаг; исправьте объявление.",
            offset,
          );
        } else {
          declare(m[1], node, "P");
          if (!wave) {
            diagnostics.add(
              structureRules.stepWave,
              "Шаг должен находиться в волне W; добавьте волну.",
              offset,
            );
          } else {
            wave.count++;
            if (documentType === "plan" && section === "Steps") {
              currentStep = m[1];
              stepEnd = node.position.end.offset;
            }
          }
        }
      } else if (/^(?:[-+*]|\d+[.)])\s+(?:\[[^\]]*\]\s+)?P-/.test(firstLine)) {
        diagnostics.add(
          structureRules.stepDeclaration,
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
        structureRules.filledDocument,
        "Осталась заготовка TODO(VF); заполните или удалите неприменимый блок.",
        offset,
      );
    }

    references.push(...textReferences(rawText, offset));
  }

  if (documentType === "intent") {
    if (!ac.length) {
      diagnostics.add(structureRules.intentCriteria, "Требуется хотя бы один AC с Verification.");
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
          structureRules.criterionVerification,
          `${item.id} требует непустой Verification; укажите способ проверки.`,
          item.node.position.start.offset,
        );
      }
    }
  }

  if (documentType === "srs" && ![...locals].some((id) => id.startsWith("R-"))) {
    diagnostics.add(
      structureRules.srsRequirements,
      "SRS требует хотя бы одно R; добавьте требование.",
    );
  }

  if (documentType === "plan") {
    if (!waves.length) {
      diagnostics.add(structureRules.planWaves, "Plan требует хотя бы одну волну W.");
    }

    for (const w of waves) {
      if (!w.count) {
        diagnostics.add(
          structureRules.waveSteps,
          "Волна должна содержать хотя бы один шаг P.",
          w.node.position.start.offset,
        );
      }

      if (
        w.execution.length !== 1 ||
        !["Execution: sequential", "Execution: parallel"].includes(w.execution[0])
      ) {
        diagnostics.add(
          structureRules.waveExecution,
          "В волне требуется одно объявление Execution: sequential или Execution: parallel.",
          w.node.position.start.offset,
        );
      }
    }
  }

  for (const field of coverFields) {
    const targets = covers.get(field.owner) ?? new Set<string>();
    for (const ref of references) {
      if (ref.offset > field.start && ref.offset < field.end) {
        targets.add(ref.value);
      }
    }

    covers.set(field.owner, targets);
  }

  const deltas =
    documentType === "spec"
      ? readRequirementDeltas(input, sectionNodes)
      : { value: [], references: [], diagnostics: [] };

  return {
    value: {
      locals,
      references: [...references, ...deltas.references],
      covers,
      deltas: deltas.value,
    },
    diagnostics: [...diagnostics.items, ...deltas.diagnostics],
  };
}
