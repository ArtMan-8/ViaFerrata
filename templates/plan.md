---
id: "{{change_id}}/plan"
status: draft
execution: not_started
created: "{{date}}"
updated: "{{date}}"
# optional: происхождение и непосредственное влияние; раскомментировать только существующие адреса.
# origin:
#   - change-000001/intent
# research:
#   - research-000001
# adr:
#   - adr-000001
---

# {{title}}

<!-- optional: Technical Approach — если подход не раскрывается достаточно ясно в шагах. -->

## Technical Approach

TODO(VF): компоненты, поток данных, интерфейсы, технические решения и совместимость.

## Steps

### W-1: Выполнение задачи

Execution: sequential

<!-- optional: дополнительные волны и Execution: parallel — по необходимости; волны идут последовательно. -->

- [ ] P-1: TODO(VF): действие и проверяемый результат.
  <!-- optional: Targets — компоненты/пути, если нужны. -->
  - Targets: TODO(VF): затрагиваемые компоненты или пути.
  <!-- optional: Covers — применимые AC/R/S/DOD; strict требует покрытия. -->
  - Covers:
    - [{{change_id}}/spec/R-1]
    <!-- optional: Verification — недостающие практические детали выполнения проверки; если способ уже достаточно конкретен в Intent/Spec, укажите ссылку. -->
  - Verification: TODO(VF): способ проверки результата шага.

<!-- optional: дополнительные шаги — по необходимости; удалить неприменимый блок. -->

- [ ] P-2: TODO(VF): следующее действие и результат.
  <!-- optional: Depends on — явная зависимость, не дублирующая очевидный sequential-порядок. -->
  - Depends on:
    - [{{change_id}}/plan/P-1]
