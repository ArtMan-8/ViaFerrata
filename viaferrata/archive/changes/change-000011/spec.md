---
id: "change-000011/spec"
status: approved
created: "2026-11-23"
updated: "2026-11-24"
scope:
  - "instructions/journal.md"
  - "instructions/workflow.md"
  - "src/cli/output.ts"
  - "src/commands/validate.ts"
  - "src/documents/*"
  - "src/rules/*"
  - "src/tests/fixtures/validation/**"
  - "src/tests/archive.test.ts"
  - "src/tests/documentation.test.ts"
  - "src/tests/validation.test.ts"
  - "src/config.ts"
  - "src/diagnostics.ts"
  - "src/rules.ts"
  - "templates/README.md"
  - "viaferrata/ideas/document-checks.md"
  - "viaferrata/ideas/document-format-evolution.md"
  - "viaferrata/specs/built-in-checks.md"
  - "viaferrata/specs/document-validation.md"
---

# Отношения документов и структурное покрытие

## Change Boundaries

Изменение затрагивает команду validate, правила отношений в [srs-000002] и правила покрытия в [srs-000001]. Формат сводки checks, команды создания документов и автоматизация завершения остаются вне области изменения.

## Requirements

### R-1: Типизированные отношения

```yaml
operation: add
changes: srs-000002/R-4
after: |-
  В lite и strict validate проверяет распознанные отношения по всем документам индекса, включая входящие из неизменённых файлов. Covers допускает AC → R задачной Spec или SRS, S задачной Spec → AC или R, S из SRS → R из SRS, P → AC, R, S или DOD. Verifies связывает V с AC, R, S, DOD или целым ADR. Changes задаётся полем changes действующей YAML-дельты R задачной Spec и указывает R SRS. Для add сохраняется исключение будущей цели. Для Covers, Depends on и Verifies используются списки ссылок соответствующего элемента по шаблонам. Обычные упоминания и примеры кода не образуют отношений. Ошибка типа указывает источник, отношение и цель и даёт ненулевой код возврата. Полнота актуальной формы архива не проверяется.
```

### R-2: Самоссылки и циклы

```yaml
operation: add
changes: srs-000002/R-5
after: |-
  Самоссылка в типизированном отношении является ошибкой. Depends on связывает два шага одного Plan. Ссылка на шаг другого change является ошибкой. Supersedes связывает целые документы одного типа из Intent, SRS, Research и ADR. CLI выявляет циклы отдельно в Depends on и supersedes, сообщает участвующие адреса и возвращает ненулевой код. Обратные ссылки вычисляются из прямых.
```

### R-3: Достижимость требования из шага Plan

```yaml
operation: modify
changes: srs-000001/R-2
before: |-
  При включённом plan-requirement-coverage команда validate проверяет каждый объявленный R рабочей Spec. В том же deep-комплекте у шага P должна быть явная связь Covers на этот R либо на AC Intent, у которого есть Covers на этот R. Отсутствие покрытия даёт E_PLAN_COVERAGE с адресом требования и ненулевой код завершения. Примеры кода, текстовые упоминания и связи другого change покрытия не дают. В архиве правило не применяется. В vibe отсутствие комплекта допустимо. Покрытие описывает план работ; проверку поведения выполняет агент или CI средствами проекта.
after: |-
  При включённом plan-requirement-coverage команда validate проверяет каждый объявленный R рабочей Spec. В том же deep-комплекте у шага P должна быть явная связь Covers на этот R, на AC Intent либо на S задачной Spec, откуда до этого R ведёт цепочка явных Covers. Допустимые пути: P → R, P → AC → R, P → S → R и P → S → AC → R. Отсутствие покрытия даёт E_PLAN_COVERAGE с адресом требования и ненулевой код завершения. Примеры кода, текстовые упоминания и связи другого change покрытия не дают. В архиве правило не применяется. В vibe отсутствие комплекта допустимо. Покрытие описывает план работ; проверку поведения выполняет агент или CI средствами проекта.
```

### R-4: Явное покрытие AC проверками

```yaml
operation: add
changes: srs-000001/R-7
after: |-
  В strict для рабочего deep-комплекта с execution in_progress validate перечисляет адреса AC текущего Intent без прямой ссылки Verifies из V его Journal. Для каждого такого AC выдаётся предупреждение, которое само по себе не меняет код возврата. В lite проект может включить ту же проверку через required_checks. Редакцию всех целей записи V задаёт её поле Revision. При отсутствии значения редакция неизвестна, явная связь сохраняется. Состояние checks, связи Covers и Changes не подтверждают результат или редакцию проверки. Это правило сообщает о структурном покрытии и не определяет допуск к completed.
```

## Definition of Done

Проверить сценарии Intent через validate на самостоятельных примерах и на репозитории ViaFerrata. Результаты, проверенную редакцию и ограничения сохранить в Journal.
