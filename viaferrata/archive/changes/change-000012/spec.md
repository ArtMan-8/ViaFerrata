---
id: "change-000012/spec"
status: approved
created: "2026-11-24"
updated: "2026-11-24"
scope:
  - "docs/quickstart.md"
  - "instructions/implementation.md"
  - "instructions/journal.md"
  - "instructions/workflow.md"
  - "src/cli/arguments.*"
  - "src/cli/cli.test.ts"
  - "src/cli/main.*"
  - "src/cli/output.ts"
  - "src/commands/complete.*"
  - "src/commands/scope.ts"
  - "src/commands/summary.*"
  - "src/commands/validate.ts"
  - "src/documents/*"
  - "src/rules/*"
  - "src/tests/documentation.test.ts"
  - "src/tests/package.integration.ts"
  - "src/tests/validation.test.ts"
  - "src/diagnostics.ts"
  - "src/rules.ts"
  - "templates/journal.md"
  - "templates/plan.md"
  - "templates/README.md"
  - "templates/spec.md"
  - "viaferrata/ideas/document-checks.md"
  - "viaferrata/specs/document-validation.md"
  - "README.md"
  - "viaferrata.toml"
---

# Допуск deep-задачи к completed

## Change Boundaries

Изменение охватывает CLI, формы документов, инструкции и действующие требования к проверке рабочего change. Исполнение проектных проверок остаётся у агента или CI. Режим vibe сохраняет работу без комплекта. Команда не запускает архивирование, коммит или публикацию.

## Requirements

### R-1: Безопасный переход

```yaml
operation: add
changes: srs-000002/R-6
after: |-
  На согласованном рабочем комплекте с execution in_progress команда vf complete change-NNNNNN проверяет наличие Intent, Spec и Plan со статусом approved, Journal с записанным основанием согласования и заполненным итогом, закрытие шагов P-* и результат проверки границ по правилам vf scope. При успехе команда меняет execution на completed и возвращает код 0. При отказе она возвращает ненулевой код, указывает нарушенное условие и сохраняет Plan. Повтор после успешного перехода сохраняет файлы. Команда сохраняет сторонние правки Plan и отказывается перезаписывать обнаруженную конкурентную правку.
```

### R-2: Обязательные проверки

```yaml
operation: add
changes: srs-000002/R-7
after: |-
  В разделе Definition of Done задачной Spec агент перечисляет применимые проектные проверки в YAML-списке completion_checks. Каждый элемент соответствует точному значению subject в checks текущего Journal. Для каждого обязательного subject нужен однозначный текущий результат passed с источником и известной редакцией входов. Отсутствие результата, конфликт текущих записей, неизвестный исход, failed и blocked препятствуют завершению. Агент устанавливает применимость результата к текущим входам и сохраняет основание в Journal. CLI читает отчёт агента или CI.
```

### R-3: Проверка каждого AC

```yaml
operation: add
changes: srs-000002/R-8
after: |-
  При включённом verification-coverage для каждого AC целевого Intent нужен Verifies из V того же Journal с известной Revision и результатом passed для этой проверки. Поле verification записи checks указывает локальный ID V. Один V может проверять несколько AC. В обычном lite пропущенный Verifies сам по себе допуска не блокирует. У агента сохраняется обязанность проверить каждый AC. vf summary продолжает читать прежние отчёты.
```

### R-4: Сохранение согласованной политики

```yaml
operation: add
changes: srs-000002/R-9
after: |-
  При согласовании агент фиксирует в Journal основание решения и контрольную сумму согласованного перечня completion_checks. Команда сверяет перечень с этим основанием и учитывает политику встроенных проверок исходной базы scope. До первой задачи подключение и настройки проекта фиксируются в Git. Для завершения базовый коммит должен содержать viaferrata.toml. Ослабление профиля ради завершения текущего change запрещено. Принятую дельту проверок агент отражает в Spec и Journal в том же change. Следствия уже принятой дельты отдельного решения не требуют.
```

### R-5: Действие правил во времени

```yaml
operation: add
changes: srs-000002/R-10
after: |-
  Команда проверяет целевой рабочий комплект и ошибки, мешающие разрешить его зависимости. Индекс включает архивные ID. vf validate сохраняет проектный охват целостности. Новые условия перехода применяются при завершении целевого change. Прежняя форма архива пропускается, конкретное расхождение формы завершённого неархивного документа может дать предупреждение. Агент показывает предупреждение пользователю. Если успешный полный validate входит в completion_checks, его результат обязателен. Синхронизация SRS и архивирование следуют после перехода.
```

## Definition of Done

Выполнить проверки по `AGENTS.md`. Для этого change применим следующий перечень.

```yaml
completion_checks:
  - npm run lint
  - npm run format:check
  - npm run typecheck
  - npm test
  - npm run build
  - npm run test:package
  - node bin/vf.ts validate
```
