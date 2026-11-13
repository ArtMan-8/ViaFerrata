import path from "node:path";
import type { Config } from "../config.ts";
import type { ValidationResult } from "../commands/validate.ts";
import { exitCode } from "../diagnostics.ts";
import { instructionFiles, type InitResult } from "../commands/init.ts";

export const help = `ViaFerrata — создание change и базовая формальная проверка

vf --help
vf --version
vf [--root PATH] init [--profile lite|strict]
vf [--root PATH] new "Название задачи"
vf [--root PATH] validate

Корень по умолчанию — cwd, без поиска родителей. Для new/validate нужен viaferrata.toml.
init подключает существующий каталог; для новой конфигурации обязателен --profile.
new создаёт три draft-документа по библиотечным формам с optional-подсказками.
validate проверяет базовую структуру, ID и существование ссылок, без изменения файлов.
Полная поддержка lite/strict, evidence и контроль завершения пока отсутствуют.
Инструкции: ${instructionFiles[0]}
Руководство форм: ${instructionFiles[1]}
`;
export const limitations =
  "Не проверены: смысл и матрица отношений, покрытие, scope/protected_paths по diff, согласование, evidence и завершение. Полная поддержка lite/strict отсутствует.";

export function initReport(result: InitResult): string {
  const { config, files, instructions } = result;
  return [
    `Корень: ${config.root}`,
    `Профиль: ${config.profile}`,
    `Корень документов: ${config.documentsRoot}`,
    ...files.map(({ file, action }) => `${file}: ${action}`),
    `Инструкции: ${instructions[0]}`,
    `Руководство форм: ${instructions[1]}`,
    "Подключение подготовлено. Следующий шаг: new → заполнение агентом → validate.",
    "Правило .gitignore исключает неотслеживаемую .viaferrata/; ранее tracked данные требуют отдельного решения.",
    "Подключение не подтверждает согласование или завершение задачи. Полная поддержка lite/strict отсутствует.",
  ].join("\n");
}

export function createdReport(config: Config, id: string): string {
  return `Создан ${id}: intent.md, spec.md, plan.md. Черновик требует заполнения; Journal не создан.\n${path.relative(config.root, path.join(config.directories.changes, id))}`;
}

export function validationReport(
  config: Config,
  result: ValidationResult,
): string[] {
  const lines: string[] = [];
  const code = exitCode(result.diagnostics);
  const errors = result.diagnostics.filter(
    (d) => d.severity === "error",
  ).length;
  lines.push(
    `Корень: ${config.root}\nПрофиль: ${config.profile}\nДокументов: ${result.documents.length}; ошибок: ${errors}; предупреждений: ${result.diagnostics.length - errors}.`,
  );
  lines.push(
    "Охват: YAML/метаданные, ID/размещение, базовые разделы/объявления, существование ссылок.",
  );
  lines.push(
    code === 2
      ? "Неполный охват: проверка не завершена."
      : code === 1
        ? "Обнаружены ошибки базовой структуры."
        : "Базовая структура проверена.",
  );
  if (!result.documents.length)
    lines.push("Документов нет; это не подтверждает готовность проекта.");
  lines.push(limitations);
  return lines;
}

export function failedValidationReport(root: string): string {
  return `Корень: ${root}\nПрофиль: не установлен из-за ошибки.\nДокументов: 0; проход не выполнен.\nНеполный охват: проверка не завершена.\n${limitations}`;
}
