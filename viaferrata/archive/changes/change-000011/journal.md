---
id: "change-000011/journal"
created: "2026-11-23"
updated: "2026-11-24"
---

# Отношения документов и структурное покрытие

## Current State

Реализация и проверки завершены.

## Significant Events

```yaml
scope_check:
  base: "34fc54fb084bdaaa9c92590e9e1e2369c22825a8"
  digest: "26ff2330795423bc25f255d3ca7ecd12b724e8a278a03bca349cc938aefd6086"
decisions:
  - "Пользователь ответил «да» на предложение принять Intent, Spec и Plan change-000011 и начать реализацию в указанном scope. Агент зафиксировал решение по переписке. Объекты Git принятой редакции: Intent cdf4457, Spec 4ec5b85, Plan e2b887b."
  - "Пользователь ограничил Depends on одним Plan и выбрал поле Revision самой записи V для всех её целей. В strict/deep при in_progress отсутствие Verifies для AC даёт предупреждение."
```

## Verification and Result

### Verification

```yaml
checks:
  - subject: Типы отношений, циклы, покрытие и совместимость
    outcome: passed
    executor: Агент
    source: npm test, 225 тестов прошли
    revision: "База 34fc54f, SHA-256 входов по scripts/input-manifest.ts — 35071405197d40116beddcc3cc3d2da975f2b44a71f9d08055f29dd377c75b44"
```

#### V-1: Валидация отношений через CLI

- Verifies:
  - [change-000011/intent/AC-1]
  - [change-000011/intent/AC-2]
  - [change-000011/intent/AC-3]
  - [change-000011/intent/AC-4]
- Revision: база 34fc54f, SHA-256 входов по scripts/input-manifest.ts — 35071405197d40116beddcc3cc3d2da975f2b44a71f9d08055f29dd377c75b44.
- Evidence: Node.js 24.22.2, npm 11.19.1. Интеграционные тесты проверили коды возврата и адреса в диагностике. При удалении Revision связь Verifies сохранилась с редакцией null, хотя в checks осталась запись passed. Первый запуск в песочнице прервался с EPERM при запуске дочерних процессов. Полный прогон выявил ошибку определения владельца Covers в прежней форме и зависимость теста от начальной вершины цикла. После исправлений все 225 тестов прошли вне песочницы. Тесты используют временные проекты со штатной очисткой.
- Result: прошли npm run typecheck, npm run lint, npm run format:check, node --test src/tests/documentation.test.ts и node bin/vf.ts validate. Перед закрытием scope проверен по согласованной базе. Отдельная проверка установки из tarball относится к сквозной проверке поставки.

### Result

CLI проверяет отношения по всем индексированным документам, учитывает сценарии при проверке Plan и сообщает о частичном покрытии AC. Достоверность запуска и допуск к completed остаются за пределами результата.
