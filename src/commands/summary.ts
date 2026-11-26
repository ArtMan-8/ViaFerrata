import fs from "node:fs/promises";
import path from "node:path";

import { parseDocument } from "yaml";

import type { Config } from "../config.ts";
import { CommandError, diagnostic, errorCode, errorMessage, isFileError } from "../diagnostics.ts";
import { plain, topLevelMarkdownNodes } from "../documents/markdown-nodes.ts";
import { requireDocumentIdentity } from "../documents/metadata.ts";
import { markdownSections, parseYamlFence } from "../documents/yaml-blocks.ts";
import { checkPath } from "../filesystem.ts";

function mapping(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function reportValue(
  document: ReturnType<typeof parseDocument>,
  file: string,
  line = 1,
  column = 1,
): unknown {
  try {
    for (const warning of document.warnings) {
      process.emitWarning(warning);
    }

    if (document.errors.length) {
      throw document.errors[0];
    }

    return document.toJS();
  } catch (error) {
    throw CommandError.fromDiagnostic(
      diagnostic(file, "E_YAML", errorMessage(error), line, column),
    );
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
    throw new CommandError("E_CLI_COMMAND_USAGE", "Пустой stdin: передайте отчёт.", "stdin");
  }

  return render(reportValue(parseDocument(input, { uniqueKeys: true }), "stdin"), "stdin");
}

export function journalReport(raw: string, file: string, bodyOffset: number) {
  // Keep fence diagnostics relative to the original Journal, including front matter.
  const headerLines = raw.slice(0, bodyOffset).split("\n").length - 1;
  const body = "\n".repeat(headerLines) + raw.slice(bodyOffset);
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
      const { line, column } = fence.position.start;
      const block = reportValue(
        parseYamlFence(fence, body, "markdown").document,
        file,
        line,
        column,
      );

      if (!mapping(block) || !Object.hasOwn(block, key)) {
        continue;
      }

      if (Object.hasOwn(report, key)) {
        throw CommandError.fromDiagnostic(
          diagnostic(file, "E_FIELD", `Несколько блоков ${key} в одном разделе.`, line, column),
        );
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

  return report;
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
      throw new CommandError("E_DOCUMENT_NOT_FOUND", "Комплект не найден.", change);
    }

    file = path.join(archived ? archive : working, "journal.md");
    await checkPath(file, false);
    if (!(await fs.stat(file)).isFile()) {
      throw new CommandError("E_IO", "Требуется обычный файл Journal.", file);
    }

    const raw = new TextDecoder("utf-8", { fatal: true }).decode(await fs.readFile(file));
    const metadata = requireDocumentIdentity({ raw, file }, change + "/journal");

    const report = journalReport(raw, file, metadata.bodyOffset);
    return `${change}${archived ? " (архив)" : ""}\n${render(report, file)}`;
  } catch (error) {
    if (errorCode(error) === "ENOENT") {
      throw new CommandError("E_DOCUMENT_NOT_FOUND", "Запрошенный Journal не найден.", file);
    }

    if (!isFileError(error) && errorCode(error) !== "ERR_ENCODING_INVALID_ENCODED_DATA") {
      throw error;
    }

    throw new CommandError("E_IO", errorMessage(error), file);
  }
}
