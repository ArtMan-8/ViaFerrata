export const documentPattern =
  /^(?:change-(\d{6})\/(intent|spec|plan|journal)|(srs|research|adr)-(\d{6}))$/;
export function identity(id) {
  if (typeof id !== "string") return null;
  const match = documentPattern.exec(id);
  if (!match || Number(match[1] ?? match[4]) === 0) return null;
  return {
    id,
    type: match[2] ?? match[3],
    change: match[1] ? `change-${match[1]}` : null,
  };
}
export const localTypes = {
  intent: ["AC"],
  spec: ["R", "S", "DOD"],
  plan: ["W", "P"],
  journal: ["V"],
  srs: ["R", "S"],
  research: [],
  adr: [],
};
export function addressIdentity(value) {
  if (typeof value !== "string") return null;
  if (/^change-\d{6}$/.test(value) && Number(value.slice(7)) > 0)
    return { bundle: value };
  const doc = identity(value);
  if (doc) return { document: value, type: doc.type };
  const at = value.lastIndexOf("/");
  const parent = identity(value.slice(0, at));
  const local = value.slice(at + 1);
  const m = /^(AC|R|S|DOD|W|P|V)-[1-9]\d*$/.exec(local);
  if (!parent || !m || !localTypes[parent.type].includes(m[1])) return null;
  return { document: parent.id, type: parent.type, local };
}
export const statuses = ["draft", "approved", "superseded", "cancelled"];
export const executions = [
  "not_started",
  "in_progress",
  "blocked",
  "completed",
  "cancelled",
];
export const requiredHeadings = {
  intent: ["Goal", "Constraints", "Context", "Acceptance Criteria"],
  spec: ["Change Boundaries", "Requirements", "Definition of Done"],
  plan: ["Steps"],
  journal: ["Current State", "Significant Events", "Verification and Result"],
  srs: ["Purpose and Boundaries", "Requirements"],
  research: [],
  adr: [],
};
