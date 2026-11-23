import fs from "node:fs/promises";
import path from "node:path";

import { parseDocument } from "yaml";

import type { Config } from "../config.ts";
import { CommandError, errorCode, errorMessage, isFileError } from "../diagnostics.ts";
import { plain, topLevelMarkdownNodes } from "../documents/markdown-nodes.ts";
import { readDocumentIdentity } from "../documents/metadata.ts";
import { markdownSections, parseYamlFence } from "../documents/yaml-blocks.ts";
import { checkPath } from "../filesystem.ts";

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reportValue(document: ReturnType<typeof parseDocument>, location: string): unknown {
  try {
    for (const warning of document.warnings) {
      process.emitWarning(warning);
    }

    if (document.errors.length) {
      throw document.errors[0];
    }
    return document.toJS();
  } catch (error) {
    throw new CommandError("E_YAML", errorMessage(error), location);
  }
}

function field(value: unknown, location: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new CommandError("E_FIELD", "Требуется непустая строка.", location);
  }

  return value;
}

function render(report: unknown, file: string): string {
  if (!mapping(report) || !Array.isArray(report.checks)) {
    throw new CommandError("E_FIELD", "Требуется список checks.", file);
  }

  const decisions = report.decisions === undefined ? [] : report.decisions;
  if (!Array.isArray(decisions)) {
    throw new CommandError("E_FIELD", "Требуется список decisions.", file);
  }

  const lines = [`Записанных проверок: ${report.checks.length}`];
  for (const [i, check] of report.checks.entries()) {
    const at = `${file}, checks[${i}]`;
    if (!mapping(check)) {
      throw new CommandError("E_FIELD", "Требуется запись проверки.", at);
    }

    const subject = field(check.subject, at + ".subject");
    const outcome = field(check.outcome, at + ".outcome");
    const source = field(check.source, at + ".source");
    const revision =
      check.revision === null
        ? "проверенная редакция неизвестна"
        : field(check.revision, at + ".revision");
    const executor =
      check.executor === null || check.executor === undefined
        ? "неизвестен"
        : field(check.executor, at + ".executor");
    lines.push(
      `${subject} — ${outcome}`,
      `  Источник: ${source}`,
      `  Редакция: ${revision}`,
      `  Исполнитель: ${executor}`,
    );
  }

  lines.push(decisions.length ? "Основания согласования:" : "Основание согласования не указано.");
  for (const [i, decision] of decisions.entries()) {
    lines.push(field(decision, `${file}, decisions[${i}]`));
  }

  return lines.join("\n");
}

export function inputSummary(input: string): string {
  if (!input.trim()) {
    throw new CommandError("E_USAGE", "Пустой stdin: передайте отчёт.", "stdin");
  }

  return render(reportValue(parseDocument(input, { uniqueKeys: true }), "stdin"), "stdin");
}

function summarizeJournalSections(body: string, file: string) {
  const report: Record<string, unknown> = {};
  for (const { section, heading, blocks } of markdownSections(topLevelMarkdownNodes(body))) {
    let key: "decisions" | "checks";
    if (section === "Significant Events") {
      key = "decisions";
    } else if (
      section === "Verification and Result" &&
      heading &&
      plain(heading) === "Verification"
    ) {
      key = "checks";
    } else {
      continue;
    }

    for (const fence of blocks) {
      const at = `${file}:${fence.position.start.line}`;
      const block = reportValue(parseYamlFence(fence, body, "markdown").document, at);
      if (!mapping(block) || !Object.hasOwn(block, key)) {
        continue;
      }

      if (Object.hasOwn(report, key)) {
        throw new CommandError("E_FIELD", `Несколько блоков ${key} в одном разделе.`, at);
      }

      report[key] = block[key];
    }
  }

  if (!Object.hasOwn(report, "checks")) {
    throw new CommandError(
      "E_FIELD",
      "Формат сводки не найден: в Verification требуется YAML-блок checks.",
      file,
    );
  }

  return render(report, file);
}

async function exists(directory: string) {
  try {
    await checkPath(directory, false);
    return true;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      return false;
    }

    throw error;
  }
}

export async function journalSummary(config: Config, change: string): Promise<string> {
  const working = path.join(config.directories.changes, change);
  const archive = path.join(config.documentsRoot, "archive", "changes", change);
  let file = working;
  try {
    const [active, archived] = await Promise.all([exists(working), exists(archive)]);
    if (active && archived) {
      throw new CommandError(
        "E_LOCATION",
        "Конфликт: комплект найден в рабочем каталоге и архиве.",
        change,
      );
    }

    if (!active && !archived) {
      throw new CommandError("E_LOCATION", "Комплект не найден.", change);
    }

    file = path.join(archived ? archive : working, "journal.md");
    await checkPath(file, false);
    if (!(await fs.stat(file)).isFile()) {
      throw new CommandError("E_IO", "Требуется обычный файл Journal.", file);
    }

    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(file));
    const metadata = readDocumentIdentity({ raw, file }).value;
    if (metadata?.identity.id !== change + "/journal") {
      throw new CommandError("E_ID", "ID Journal не соответствует выбранному change.", file);
    }

    // Preserve document line numbers for diagnostics in fenced YAML blocks.
    const headerLines = raw.slice(0, metadata.bodyOffset).split("\n").length - 1;
    const summary = summarizeJournalSections(
      "\n".repeat(headerLines) + raw.slice(metadata.bodyOffset),
      file,
    );
    return `${change}${archived ? " (архив)" : ""}\n${summary}`;
  } catch (error) {
    if (!isFileError(error) && errorCode(error) !== "ERR_ENCODING_INVALID_ENCODED_DATA") {
      throw error;
    }

    if (error instanceof CommandError) {
      throw error;
    }

    throw new CommandError("E_IO", errorMessage(error), file);
  }
}
