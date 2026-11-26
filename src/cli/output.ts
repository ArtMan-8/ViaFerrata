import path from "node:path";

import type { InitResult } from "../commands/init.ts";
import type { ValidationResult } from "../commands/validate.ts";
import type { Config } from "../config.ts";
import { exitCode } from "../diagnostics.ts";
import { instructionFiles } from "../resources.ts";
import { coverageRules } from "../rules/coverage.ts";
import { commandHelp } from "./arguments.ts";

export const help = `ViaFerrata — подключение проекта, создание черновиков и структурная проверка документов

vf --help
vf --version
${commandHelp}

new/validate ищут ближайший viaferrata.toml вверх от cwd; неверная конфигурация останавливает поиск.
scope сверяет пути Git с согласованным scope; --digest выводит сумму масок рабочей Spec.
summary читает Journal по ID в подключённом проекте либо один отчёт YAML/JSON из stdin.
init использует path либо cwd; первое подключение внутри другого проекта запрещено.
Опции --profile и --documents-root допускаются до и после init, значение — через пробел или =; повторы запрещены.
--help и --version используются самостоятельно, без команды и других опций.
init подключает существующий каталог; для новой конфигурации обязателен --profile.
new создаёт комплект change или один документ выбранного типа по форме пакета.
validate проверяет метаданные, ID, обязательные разделы, placeholders и существование ссылок, без изменения файлов.
complete проверяет условия завершения deep-задачи и обновляет execution рабочего Plan.
Инструкции: ${instructionFiles.workflow}
Руководство форм: ${instructionFiles.templates}
`;
export const limitations =
  "Не проверены: смысл отношений, покрытие тестами, scope по diff, согласование, evidence и завершение. Полная поддержка lite/strict отсутствует.";

export function initReport(result: InitResult): string {
  const { config, files, instructions } = result;
  return [
    `Корень: ${config.root}`,
    `Профиль: ${config.profile}`,
    `Корень документов: ${config.documentsRoot}`,
    ...files.map(({ file, action }) => `${file}: ${action}`),
    `Инструкции: ${instructions.workflow}`,
    `Руководство форм: ${instructions.templates}`,
    "Подключение подготовлено. Откройте проект с агентом и опишите задачу: что хотите изменить и по чему поймёте, что готово.",
    "Правило .gitignore исключает неотслеживаемую .viaferrata/; ранее tracked данные требуют отдельного решения.",
    "Подключение не подтверждает согласование или завершение задачи. Полная поддержка lite/strict отсутствует.",
  ].join("\n");
}

export function createdReport(config: Config, id: string, destination: string): string {
  const relative = path.relative(config.root, destination);

  if (!id.startsWith("change-")) {
    return `Создан ${id}: ${path.basename(destination)}. Черновик требует заполнения.\n${relative}`;
  }

  return `Создан ${id}: intent.md, spec.md, plan.md. Черновик требует заполнения; Journal не создан.\n${relative}`;
}

export function validationReport(config: Config, result: ValidationResult): string[] {
  const lines: string[] = [];
  const code = exitCode(result.diagnostics);
  const errors = result.diagnostics.filter((d) => d.severity === "error").length;

  lines.push(
    `Корень: ${config.root}\nПрофиль: ${config.profile}\nДокументов: ${result.documents.length}; ошибок: ${errors}; предупреждений: ${result.diagnostics.length - errors}.`,
  );

  lines.push(
    "Охват: YAML/метаданные, ID/размещение, дельты, ссылки, типы отношений и циклы Depends on и supersedes; текущая форма вне архива. Архив индексируется без проверки полноты актуальной формы. Историческая идентичность не доказывает редакцию требования.",
  );

  lines.push(
    code === 2
      ? "Неполный охват: проверка не завершена."
      : code === 1
        ? "Обнаружены ошибки базовой структуры."
        : "Базовая структура проверена.",
  );

  if (!result.documents.length) {
    lines.push("Документов нет; это не подтверждает готовность проекта.");
  }

  if (config.enabledRules.has(coverageRules.planRequirementCoverage.id)) {
    lines.push(
      `Включено правило ${coverageRules.planRequirementCoverage.id}: связи шагов Plan с требованиями рабочих deep-комплектов.`,
    );
  }

  if (config.enabledRules.has(coverageRules.verificationCoverage.id)) {
    lines.push(
      `Включено правило ${coverageRules.verificationCoverage.id}: явные Verifies для AC при execution in_progress.`,
    );
  }

  lines.push(limitations);
  return lines;
}

export function failedValidationReport(root: string): string {
  return `Корень: ${root}\nПрофиль: не установлен из-за ошибки.\nДокументов: 0; проход не выполнен.\nНеполный охват: проверка не завершена.\n${limitations}`;
}
