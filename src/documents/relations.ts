import type { Diagnostic } from "../diagnostics.ts";
import { referenceRules } from "../rules/reference.ts";
import { SourceDiagnostics } from "./diagnostics.ts";
import { addressIdentity } from "./schema.ts";
import type { AddressIdentity, ParsedDocument, Reference } from "./types.ts";

interface Edge {
  doc: ParsedDocument;
  ref: Reference;
}

function allowed(source: string, ref: Reference, target: AddressIdentity): boolean {
  const owner = ref.owner?.split("-")[0];
  const local = target.local?.split("-")[0];
  switch (ref.key) {
    case "Changes":
      return owner === "R" && target.type === "srs" && local === "R";
    case "Depends on":
      return owner === "P" && local === "P" && target.document === source;
    case "Verifies":
      return (
        owner === "V" && (["AC", "R", "S", "DOD"].includes(local ?? "") || target.type === "adr")
      );
    case "Covers":
      if (owner === "P") {
        return ["AC", "R", "S", "DOD"].includes(local ?? "");
      }
      if (owner === "AC") {
        return local === "R";
      }
      if (owner === "S" && source.startsWith("srs-")) {
        return local === "R" && target.type === "srs";
      }
      return owner === "S" && (local === "AC" || local === "R");
    default:
      return true;
  }
}

// Each stack frame retains the next edge to visit, so long dependency chains
// do not depend on the JavaScript call stack.
function cycles(graph: ReadonlyMap<string, Edge[]>): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const visited = new Set<string>();
  for (const root of graph.keys()) {
    if (visited.has(root)) {
      continue;
    }

    const active = new Map<string, number>();
    const stack: { id: string; edges: Iterator<Edge> }[] = [];
    function enter(id: string) {
      active.set(id, stack.length);
      visited.add(id);
      stack.push({ id, edges: (graph.get(id) ?? []).values() });
    }
    enter(root);
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const next = frame.edges.next();
      if (next.done) {
        active.delete(frame.id);
        stack.pop();
        continue;
      }

      const { doc, ref } = next.value;
      const start = active.get(ref.value);
      if (start !== undefined) {
        const path = [...stack.slice(start).map((item) => item.id), ref.value];
        const collector = new SourceDiagnostics(doc);
        collector.add(
          referenceRules.relationCycle,
          `Цикл ${ref.key}: ${path.join(" → ")}.`,
          ref.offset,
        );
        diagnostics.push(...collector.items);
      } else if (!visited.has(ref.value)) {
        enter(ref.value);
      }
    }
  }
  return diagnostics;
}

export interface IncomingRelation {
  source: string;
  kind: string;
  revision?: string | null;
}

export function indexRelations(documents: readonly ParsedDocument[]) {
  const incoming = new Map<string, IncomingRelation[]>();
  const diagnostics: Diagnostic[] = [];
  const dependencies = new Map<string, Edge[]>();
  const replacements = new Map<string, Edge[]>();
  for (const doc of documents) {
    if (!doc.metadata) {
      continue;
    }

    const id = doc.metadata.identity.id;
    const collector = new SourceDiagnostics(doc);
    for (const ref of [...doc.metadata.references, ...(doc.body?.references ?? [])]) {
      if (!ref.key || (ref.key !== "supersedes" && ref.owner === undefined)) {
        continue;
      }

      const source = ref.owner ? id + "/" + ref.owner : id;
      if (ref.value === source) {
        collector.add(
          referenceRules.relationSelf,
          `${source}: самоссылка ${ref.key} → ${ref.value}.`,
          ref.offset,
        );

        continue;
      }

      const target = addressIdentity(ref.value);
      if (!target) {
        continue;
      }

      if (!allowed(id, ref, target)) {
        collector.add(
          referenceRules.relationType,
          `Недопустимая связь ${source} → ${ref.value} (${ref.key}).`,
          ref.offset,
        );

        continue;
      }

      if (
        ref.key === "supersedes" &&
        (target.type !== doc.metadata.identity.type || target.local)
      ) {
        continue;
      }

      const incomingEdges = incoming.get(ref.value) ?? [];
      incomingEdges.push({
        source,
        kind: ref.key,
        ...(ref.key === "Verifies"
          ? { revision: doc.body?.revisions?.get(ref.owner ?? "") ?? null }
          : {}),
      });

      incoming.set(ref.value, incomingEdges);
      if (ref.key === "Depends on" || ref.key === "supersedes") {
        const graph = ref.key === "Depends on" ? dependencies : replacements;
        const edges = graph.get(source) ?? [];
        edges.push({ doc, ref });
        graph.set(source, edges);
      }
    }

    diagnostics.push(...collector.items);
  }

  return {
    incoming,
    diagnostics: [...diagnostics, ...cycles(dependencies), ...cycles(replacements)],
  };
}
