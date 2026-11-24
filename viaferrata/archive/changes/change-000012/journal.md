---
id: "change-000012/journal"
created: "2026-11-24"
updated: "2026-11-24"
---

# Допуск deep-задачи к completed

## Current State

Команда `vf complete change-000012` перевела Plan в completed после проверки согласованного scope и результатов в Journal.

## Significant Events

```yaml
decisions:
  - "Пользователь принял Intent, Spec и Plan ответом «ок, принимаю» после исправления масок scope. Приняты условия допуска, формат отчёта, правила пересмотра проверок и обработка исторических документов. Основание записал агент по переписке."
  - "Пользователь установил порядок: сначала коммит с подключением и настройками, затем задачи."
  - 'Пользователь разрешил добавить viaferrata.toml в scope для удаления комментария # documents_root = "viaferrata" # default. Профиль lite сохраняется.'
scope_check:
  base: "23e7877783bcdc9e16a2960082af9df6d373082f"
  digest: "3e588434c380271d09a45ad3624a827996ba963f1d857024ad04a50e45e8bb54"
completion_digest: "22c80970b91ca590cab90add67cbd0473f83455f1dab90c41a6760f393a2816a"
```

## Verification and Result

### Verification

Редакция перед completed включает проверенные правки реализации, тестов, документации и конфигурации. В checks указан SHA-256 отсортированных изменённых путей и хешей их содержимого, записанный при завершении. При последующем ревью пересчёт по текущему набору проиндексированных изменений дал другую сумму. Совпадение текущего снимка с проверенным не установлено.

```yaml
checks:
  - subject: "npm run lint"
    outcome: passed
    source: "Локальный запуск агента, код 0"
    revision: "23e7877 + SHA-256 a8f81baf0917336c1a06fff7f0ded61432d8de3bf71f1b2c203144fd3f967179"
  - subject: "npm run format:check"
    outcome: passed
    source: "Локальный запуск агента, код 0"
    revision: "23e7877 + SHA-256 a8f81baf0917336c1a06fff7f0ded61432d8de3bf71f1b2c203144fd3f967179"
  - subject: "npm run typecheck"
    outcome: passed
    source: "Локальный запуск агента, код 0"
    revision: "23e7877 + SHA-256 a8f81baf0917336c1a06fff7f0ded61432d8de3bf71f1b2c203144fd3f967179"
  - subject: "npm test"
    verification: V-1
    outcome: passed
    source: "Локальный запуск агента, 226 тестов прошли"
    revision: "23e7877 + SHA-256 a8f81baf0917336c1a06fff7f0ded61432d8de3bf71f1b2c203144fd3f967179"
  - subject: "npm run build"
    outcome: passed
    source: "Локальный запуск агента, код 0"
    revision: "23e7877 + SHA-256 a8f81baf0917336c1a06fff7f0ded61432d8de3bf71f1b2c203144fd3f967179"
  - subject: "npm run test:package"
    outcome: passed
    source: "Локальная установка tarball во временном проекте, 1 тест прошёл"
    revision: "23e7877 + SHA-256 a8f81baf0917336c1a06fff7f0ded61432d8de3bf71f1b2c203144fd3f967179"
  - subject: "node bin/vf.ts validate"
    outcome: passed
    source: "Локальный запуск агента до записи результатов, 50 документов, 0 ошибок и предупреждений"
    revision: "23e7877 + SHA-256 a8f81baf0917336c1a06fff7f0ded61432d8de3bf71f1b2c203144fd3f967179"
  - subject: "Дополнительные сценарии завершения"
    outcome: passed
    source: "Локальный запуск агента во временных копиях Git-проекта"
    revision: "23e7877 + SHA-256 a8f81baf0917336c1a06fff7f0ded61432d8de3bf71f1b2c203144fd3f967179"
    verification: V-2
```

#### V-1: Проверка команды в проектах Git

- Verifies:
  - [change-000012/intent/AC-1]
  - [change-000012/intent/AC-2]
  - [change-000012/intent/AC-3]
  - [change-000012/intent/AC-4]
  - [change-000012/intent/AC-5]
- Result: При отказе Plan сохранялся, при успехе переходил в completed. Проверены обязательный результат, связи с AC, профили, исходная конфигурация и ошибка в ссылке текущего Intent. Чужой неполный комплект не помешал завершению.
- Revision: 23e7877 + рабочие изменения перед completed.
- Evidence: `npm test` включал сценарий `src/commands/complete.test.ts`. Отдельный запуск этого теста после уточнения порядка подключения подтвердил E_CONFIG при отсутствии viaferrata.toml в базе.

#### V-2: Дополнительные сценарии завершения

- Verifies:
  - [change-000012/intent/AC-1]
  - [change-000012/intent/AC-2]
  - [change-000012/intent/AC-3]
  - [change-000012/intent/AC-4]
  - [change-000012/intent/AC-5]
- Result: Команда сохранила Plan при ошибке записи. После удаления противоречивой записи и после согласованной дельты перечня проверок завершение прошло. В strict ошибка проверки одного AC блокировала завершение при успешных остальных проверках.
- Revision: 23e7877 + рабочие изменения перед completed.
- Evidence: Агент запускал CLI во временных Git-проектах. Для случая ошибки записи каталог Plan был доступен только для чтения. Для исторических Journal агент сравнил содержимое до и после успешного перехода.

### Result

При последующем ревью агент проверил в копии проекта три Journal. Отсутствие Current State в завершённом рабочем Journal дало W_FORM, переход целевого change завершился с кодом 0. Та же прежняя форма в архиве предупреждения не вызвала. Без раздела Result в целевом Journal команда вернула E_FIELD и сохранила Plan. Оба исторических файла сохранили исходные байты.

В strict обнаружено расхождение с R-3. При двух V для одного AC команда отказала с E_FIELD из-за отсутствующей Revision у второго V, хотя первый V имел известную редакцию и успешный исход. Этот случай воспроизведён после завершения задачи.

CLI завершает рабочую deep-задачу по согласованным границам Git и записанным результатам. Агент отвечает за достоверность источника и применимость результата к текущим входам.
