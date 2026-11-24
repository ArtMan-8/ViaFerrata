import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { isScalar, parseDocument } from "yaml";

import { parseConfig, type Config } from "../config.ts";
import { CommandError, errorMessage, formatDiagnostic, type Diagnostic } from "../diagnostics.ts";
import { plain, topLevelMarkdownNodes } from "../documents/markdown-nodes.ts";
import { addressIdentity } from "../documents/schema.ts";
import type { ParsedDocument } from "../documents/types.ts";
import { markdownSections, parseYamlFence } from "../documents/yaml-blocks.ts";
import { checkPath, writeAndClose } from "../filesystem.ts";
import { checkScope } from "./scope.ts";
import { journalReport } from "./summary.ts";
import { validateProject, type ValidationResult } from "./validate.ts";

function fail(message: string, file: string): never {
  throw new CommandError("E_FIELD", message, file);
}

function mapping(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function string(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function body(doc: ParsedDocument) {
  return doc.raw.slice(doc.metadata!.bodyOffset);
}

function sectionFields(doc: ParsedDocument, sectionName: string) {
  const source = body(doc);
  const fields = new Map<string, unknown>();
  for (const { section, blocks } of markdownSections(topLevelMarkdownNodes(source))) {
    if (section !== sectionName) {
      continue;
    }

    for (const block of blocks) {
      const { document, closed } = parseYamlFence(block, source, "markdown");
      if (!closed || document.errors.length || document.warnings.length) {
        fail("Некорректный YAML в " + section, doc.file);
      }

      const values: unknown = document.toJS();
      if (!mapping(values)) {
        continue;
      }

      for (const [key, value] of Object.entries(values)) {
        if (fields.has(key)) {
          fail("Повтор поля " + key, doc.file);
        }

        fields.set(key, value);
      }
    }
  }

  return fields;
}

function hasResult(doc: ParsedDocument) {
  let section = "",
    subsection = "";
  for (const node of topLevelMarkdownNodes(body(doc))) {
    if (node.type === "heading" && node.depth <= 3) {
      if (node.depth <= 2) {
        section = node.depth === 2 ? plain(node) : "";
      }

      subsection = node.depth === 3 ? plain(node) : "";
    } else if (
      section === "Verification and Result" &&
      subsection === "Result" &&
      (node.type === "paragraph" || node.type === "list") &&
      string(plain(node))
    ) {
      return true;
    }
  }

  return false;
}

function relevantFiles(project: ValidationResult, change: string) {
  const files = new Set<string>();
  const pending = [...(project.index.bundles.get(change)?.values() ?? [])];
  while (pending.length) {
    const doc = pending.pop()!;
    if (files.has(doc.file)) {
      continue;
    }

    files.add(doc.file);
    for (const ref of [...(doc.metadata?.references ?? []), ...(doc.body?.references ?? [])]) {
      if (ref.key === "origin" || ref.key === "supersedes") {
        continue;
      }

      const addr = addressIdentity(ref.value);
      if (addr?.document) {
        const dep = project.index.documents.get(addr.document);
        if (dep && !dep.archived) {
          pending.push(dep);
        }
      } else if (addr?.bundle) {
        for (const dep of project.index.bundles.get(addr.bundle)?.values() ?? []) {
          if (!dep.archived) {
            pending.push(dep);
          }
        }
      }
    }
  }

  return files;
}

async function checkPolicy(config: Config, journal: ParsedDocument, checks: string[]) {
  const events = sectionFields(journal, "Significant Events");
  const digest = createHash("sha256").update(JSON.stringify(checks.toSorted())).digest("hex");
  if (events.get("completion_digest") !== digest) {
    fail(
      "Сверьте согласованный перечень completion_checks и completion_digest. Сумма текущего перечня: " +
        digest,
      journal.file,
    );
  }
  const scope = events.get("scope_check");
  if (
    !mapping(scope) ||
    !string(scope.base) ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(scope.base)
  ) {
    fail("Требуется scope_check.base.", journal.file);
  }

  let raw: string;
  try {
    const result = await promisify(execFile)("git", ["show", scope.base + ":viaferrata.toml"], {
      cwd: config.root,
    });
    raw = result.stdout;
  } catch (error) {
    throw new CommandError(
      "E_CONFIG",
      "Проверьте viaferrata.toml в базовом коммите: до первой задачи сохраните подключение и настройки проекта отдельным коммитом. Причина: " +
        errorMessage(error),
      "viaferrata.toml",
    );
  }

  const original = parseConfig(config.root, raw);
  if (original.profile === "strict" && config.profile !== "strict") {
    fail("Исходный профиль strict ослаблен.", "viaferrata.toml");
  }

  for (const rule of original.enabledRules) {
    if (!config.enabledRules.has(rule)) {
      fail("Отключено исходное правило " + rule, "viaferrata.toml");
    }
  }
}

function successful(record: Record<string, unknown>) {
  return record.outcome === "passed" && string(record.source) && string(record.revision);
}

function verifyReport(
  journal: ParsedDocument,
  checks: string[],
  intent: ParsedDocument,
  coverage: boolean,
) {
  const { checks: records } = journalReport(body(journal), journal.file);
  if (!Array.isArray(records) || !records.every(mapping)) {
    fail("Требуется список checks с результатами.", journal.file);
  }

  for (const record of records) {
    if (
      !string(record.subject) ||
      !string(record.outcome) ||
      !string(record.source) ||
      !(record.revision === null || string(record.revision))
    ) {
      fail("Проверьте subject, outcome, source и revision записи checks.", journal.file);
    }

    if (
      record.verification !== undefined &&
      (!string(record.verification) ||
        !/^V-[1-9]\d*$/.test(record.verification) ||
        !journal.body?.locals.has(record.verification))
    ) {
      fail("Неизвестный verification: " + JSON.stringify(record.verification), journal.file);
    }
  }

  for (const subject of checks) {
    const matches = records.filter((record) => record.subject === subject);
    if (matches.length !== 1 || !successful(matches[0])) {
      fail(
        "Для " + subject + " требуется один текущий результат passed с источником и редакцией.",
        journal.file,
      );
    }
  }

  if (!coverage) {
    return;
  }

  for (const ac of intent.body!.locals) {
    if (!ac.startsWith("AC-")) {
      continue;
    }

    const target = intent.metadata!.identity.id + "/" + ac;
    const verifications = (journal.body?.references ?? []).filter(
      (ref) => ref.key === "Verifies" && ref.value === target,
    );
    if (!verifications.length) {
      fail("Нет Verifies для " + target, journal.file);
    }

    const covered = verifications.some(({ owner }) => {
      if (!owner || !journal.body?.revisions?.get(owner)) {
        return false;
      }

      const rows = records.filter((record) => record.verification === owner);
      return rows.length > 0 && rows.every(successful);
    });

    if (!covered) {
      const ids = verifications.map((ref) => ref.owner).join(", ");
      fail("Для " + target + " проверьте Revision и исход проверок: " + ids, journal.file);
    }
  }
}

async function writeCompleted(plan: ParsedDocument) {
  const start = plan.raw.indexOf("\n") + 1;
  const header = plan.raw
    .slice(start, plan.metadata!.bodyOffset)
    .replace(/\r?\n---[ \t]*(?:\r?\n)?$/, "");
  const node = parseDocument(header).get("execution", true);
  if (!isScalar(node) || !node.range || node.value !== "in_progress") {
    fail("Проверьте поле execution.", plan.file);
  }

  const next =
    plan.raw.slice(0, start + node.range[0]) + "completed" + plan.raw.slice(start + node.range[1]);
  const temp = path.join(path.dirname(plan.absolute), ".complete-" + randomUUID());
  await checkPath(plan.absolute, false);
  const handle = await fs.open(temp, "wx", (await fs.stat(plan.absolute)).mode);
  try {
    await writeAndClose(handle, () => handle.writeFile(next));
    if (!(await fs.readFile(plan.absolute)).equals(Buffer.from(plan.raw))) {
      fail("Plan изменился во время проверки. Повторите завершение.", plan.file);
    }
    await fs.rename(temp, plan.absolute);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

export async function completeChange(
  config: Config,
  change: string,
  warn: (item: Diagnostic) => void,
) {
  const project = await validateProject(config);
  const bundle = project.index.bundles.get(change);
  const dir = path.relative(config.root, path.join(config.directories.changes, change));
  const files = relevantFiles(project, change);
  for (const item of project.diagnostics) {
    if (item.severity === "warning") {
      warn(item);
    } else if (files.has(item.file) || item.file === dir || item.file.startsWith(dir + path.sep)) {
      throw new CommandError(item.code, formatDiagnostic(item), item.file);
    }
  }
  const plan = bundle?.get("plan"),
    intent = bundle?.get("intent"),
    spec = bundle?.get("spec"),
    journal = bundle?.get("journal");
  if (!plan || plan.archived || !intent || !spec || !journal) {
    fail("Требуется полный рабочий комплект.", dir);
  }

  if (plan.metadata?.fields.execution === "completed") {
    return change + ": уже completed.";
  }

  if (plan.metadata?.fields.execution !== "in_progress") {
    fail("Для завершения требуется in_progress.", plan.file);
  }

  for (const doc of [plan, intent, spec]) {
    if (doc.metadata?.fields.status !== "approved") {
      fail("Требуется status approved.", doc.file);
    }
  }

  if (!plan.body?.locals.size || ![...plan.body.locals].some((id) => id.startsWith("P-"))) {
    fail("В Plan отсутствуют шаги.", plan.file);
  }

  if (plan.body.openSteps?.length) {
    fail("Открытые шаги: " + plan.body.openSteps.join(", "), plan.file);
  }

  if (!hasResult(journal)) {
    fail("Заполните Result в Journal.", journal.file);
  }

  await checkScope(config, change, false);
  const checks = sectionFields(spec, "Definition of Done").get("completion_checks");
  if (!Array.isArray(checks) || !checks.every(string) || new Set(checks).size !== checks.length) {
    fail("Требуется список уникальных completion_checks.", spec.file);
  }

  await checkPolicy(config, journal, checks);
  verifyReport(journal, checks, intent, config.enabledRules.has("verification-coverage"));
  await writeCompleted(plan);

  return change + ": completed.";
}
