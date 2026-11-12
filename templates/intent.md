---
id: "{{change_id}}/intent"
status: draft
created: "{{date}}"
updated: "{{date}}"
# optional: происхождение и непосредственное влияние; раскомментировать только существующие адреса.
# origin:
#   - change-000001/intent
# research:
#   - research-000001
# adr:
#   - adr-000001
# optional: замена другого Intent; использовать реальный адрес.
# supersedes:
#   - change-000001/intent
---

# {{title}}

## Goal

TODO(VF): проблема, кого она затрагивает, и желаемый результат.

## Constraints

TODO(VF): применимые общие и задачные ограничения.

## Context

TODO(VF): текущее положение, необходимые факты и зависимости; влияние связанных Research/ADR.

<!-- optional: Examples — оставить, если примеры уточняют результат; иначе удалить раздел. -->

## Examples

TODO(VF): примеры и контрпримеры, входы и ожидаемые результаты.

## Acceptance Criteria

### AC-1: Критерий требует заполнения

TODO(VF): наблюдаемое условие принятия.

<!-- optional: Covers — при явном R; strict требует применимых связей. Допустима цель SRS. -->

- Covers:
  - [{{change_id}}/spec/R-1]
- Verification: TODO(VF): способ проверки условия, не результат запуска.
