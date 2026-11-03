---
date: 2026-11-03
scope:
  - package.json
  - package-lock.json
  - tsconfig.json
  - .node-version
  - bin/**
  - src/**
  - test/**
  - .github/workflows/**
  - README.md
  - work/tasks/T-0001_toolchain-skeleton/T-0001_impl.md
tests:
  - test/**
ac:
  - { id: AC-1, check: test }
  - { id: AC-2, check: test }
  - { id: AC-3, check: test }
  - { id: AC-4, check: test }
  - { id: AC-5, check: test }
  - { id: AC-6, check: test }
  - { id: AC-7, check: test }
  - { id: AC-8, check: test }
  - { id: AC-9, check: manual }
  - { id: AC-10, check: manual }
---

# T-0001: Каркас инструмента

## Intent

### Goal

Создать минимальный работающий каркас `viaferrata`: npm-пакет, конфигурацию TypeScript, входную точку `bin/vf.mjs` на чистом JavaScript, которая проверяет версию Node и загружает `src/cli.ts`, тест-раннер и CI на трёх ОС. Каркас должен доказывать, что инструмент запускается без сборки и без рантайм-зависимостей, а на старом Node даёт понятную ошибку. Команд, кроме `--version`, пока нет.

### Constraints

- Node.js `>= 24.22.2`, ESM; TypeScript со стиранием типов, только стираемый синтаксис; TypeScript 7.0.2 и `@types/node` 24.x — dev-зависимости (точная версия — в lockfile); рантайм-зависимостей нет.
- `package.json`: `name: viaferrata`, `version: 0.0.0`, английское `description`, `license: MIT`, `private: true`, `type: module`, `bin.vf = ./bin/vf.mjs`, `engines.node = >=24.22.2`; скрипты `test`, `typecheck`, `start` без shell-синтаксиса (`&&`, `||`, `|`, перенаправлений, `$()`).
- `bin/vf.mjs` — чистый JavaScript; проверка версии выполняется до динамического импорта `src/cli.ts`; используются только встроенные модули Node.
- Минимальная версия Node хранится одной константой в JS-части; тест сверяет её с `engines.node`, чтобы значения не разъехались.
- `tsconfig.json`: `target` и `lib` — `ES2024`, `module` и `moduleResolution` — `nodenext`, `noEmit`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `strict`, `allowImportingTsExtensions`, `types: ["node"]`.
- CI: GitHub Actions по `pull_request` и `push` в `trunk`, `fail-fast: false`; матрица `ubuntu-24.04`, `macos-26`, `windows-2025` × Node `24.22.2`, `26.13.0`; в каждой ячейке `npm ci`, `npm test`, `npm run typecheck`; дополнительно `old-node` на ubuntu с Node `22.12.0` (проверка пути ошибки, не поддержка) и `clean-machine` в контейнере `node:24.22.2-bookworm` без `npm ci`.
- `.gitattributes` уже содержит `* text=auto eol=lf`, `.gitignore` уже исключает `node_modules/`; оба файла не меняются.
- `vf check` и `vf red` ещё не существуют: проверки и журнал ведутся вручную; файл спецификации в PR 2 не меняется. Публикации нет: `private: true` снимается только в релизной задаче.

### Context

- ADR-0001 задаёт процесс, ветки и диалект глобов: [`ADR-0001`](../../decisions/ADR-0001_pull-requests.md).
- ADR-0002 задаёт рантайм, язык и входную точку: [`ADR-0002`](../../decisions/ADR-0002_runtime-and-language.md).
- ADR-0003 задаёт платформы и CI-матрицу: [`ADR-0003`](../../decisions/ADR-0003_platforms-and-ci.md).
- ADR-0004 задаёт контракт `bin/vf.mjs` и отсутствие рантайм-зависимостей: [`ADR-0004`](../../decisions/ADR-0004_delivery-to-release.md).
- Формат этой спецификации — [`ADR-0005`](../../decisions/ADR-0005_spec-header.md); шаблон — [`spec.md`](../../templates/spec.md).
- Замеры, версии TypeScript и поведение тест-раннера: [`R-0001`](../../research/R-0001_runtime-platforms-delivery.md).
- Локальная среда — WSL2 и Node 24.22.2 через nvm; Node 26, macOS и нативный Windows проверяются только в CI.

### Examples

```text
$ node bin/vf.mjs --version
viaferrata 0.0.0
$ node bin/vf.mjs
vf: no command given; try "vf --version"
$ node bin/vf.mjs --unknown
vf: unknown option "--unknown"; try "vf --version"
```

На Node ниже границы:

```text
$ node bin/vf.mjs --version
viaferrata requires Node.js >= 24.22.2; current is 22.12.0. Install Node.js: https://nodejs.org/en/download
$ echo $?
1
```

### Acceptance Criteria

Acceptance Criteria (AC, критерии приёмки) — наблюдаемые условия, по которым задача принимается; тип проверки каждого AC указан в шапке.

- **AC-1** — `package.json` содержит `name: viaferrata`, `description`, `version`, `license`, `private: true`, `type: module`, `engines.node = >=24.22.2`, `bin.vf = ./bin/vf.mjs`, нет `dependencies`; dev-зависимости — TypeScript 7.0.2 и `@types/node` 24.x; скрипты `test`, `typecheck`, `start` без shell-синтаксиса. `Covers: S-1, S-7`.
- **AC-2** — `tsconfig.json` содержит заданные флаги, включает `src/**/*.ts` и `test/**/*.ts`, `tsc --noEmit` проходит. `Covers: S-5`.
- **AC-3** — `node bin/vf.mjs --version` печатает `viaferrata <версия из package.json>` и завершается с кодом 0; вызов без команды или с неизвестным аргументом печатает одну строку в stderr и завершается с кодом 2. `Covers: S-1, S-2`.
- **AC-4** — на Node ниже 24.22.2 `node bin/vf.mjs --version` завершается с кодом 1, печатает понятное сообщение с требуемой и текущей версиями и не печатает `ERR_UNKNOWN_FILE_EXTENSION`. `Covers: S-3`.
- **AC-5** — `node --test` без аргументов обнаруживает и запускает все тестовые файлы из `test/**` (`*.test.ts` и `old-node.test.mjs`), включая `old-node`-тест, который пропускается на поддерживаемом Node; прогон завершается с кодом 0. `Covers: S-4`.
- **AC-6** — CI-матрица 3 × 2 зелёная: в каждой ячейке проходят `npm ci`, `npm test` и `npm run typecheck`; отчёт PR содержит все шесть ячеек. `Covers: S-5`.
- **AC-7** — `clean-machine` в контейнере `node:24.22.2-bookworm` без `npm ci` запускает `node --test` и `node bin/vf.mjs --version`; оба завершаются с кодом 0. `Covers: S-4`.
- **AC-8** — запуск `--version` из копии инструмента в каталоге с пробелом и кириллицей в пути завершается с кодом 0 и печатает версию. `Covers: S-6`.
- **AC-9** — README содержит требование Node `>= 24.22.2` и команду `node bin/vf.mjs --version`. `Covers: S-8`.
- **AC-10** — `T-0001_impl.md` содержит красное свидетельство (команды, коды выхода, литеральный падающий вывод), статус `in-progress`, результаты AC и раздел «Уточнения» с пометкой, что `vf check` и `vf red` ещё отсутствуют. `Covers: S-9`.

## Specification

### Change boundaries

Меняются: `package.json`, `package-lock.json`, `tsconfig.json`, `.node-version`, `bin/**`, `src/**`, `test/**`,
`.github/workflows/**`, `README.md`, `work/tasks/T-0001_toolchain-skeleton/T-0001_impl.md`.

В PR 2 не меняются: `.gitattributes` (уже `eol=lf`), `.gitignore`, `AGENTS.md`, `LICENSE`, `work/decisions/**`, `work/templates/**`, `work/research/**`, другие задачи. Файл `T-0001_spec.md` в PR 2 не меняется.

### Scenarios

#### Scenario S-1: Поддерживаемый Node и `--version`

- **Given** установлен Node `>= 24.22.2` и пакет собран из рабочего дерева
- **When** выполняется `node bin/vf.mjs --version`
- **Then** в stdout печатается `viaferrata 0.0.0`; код выхода — 0

#### Scenario S-2: Нет команды или неизвестный аргумент

- **Given** установлен поддерживаемый Node
- **When** выполняется `node bin/vf.mjs` или `node bin/vf.mjs --unknown`
- **Then** в stderr печатается одна строка с подсказкой `vf --version`; код выхода — 2, стек не печатается

#### Scenario S-3: Node ниже границы

- **Given** установлен Node `22.12.0`
- **When** выполняется `node bin/vf.mjs --version`
- **Then** в stderr печатается сообщение с требуемой версией `24.22.2` и текущей `22.12.0`; сообщение не содержит `ERR_UNKNOWN_FILE_EXTENSION`; код выхода — 1

#### Scenario S-4: Тесты без `node_modules`

- **Given** чистое рабочее дерево без `node_modules`
- **When** выполняется `node --test`
- **Then** все тесты из `test/**` обнаруживаются и проходят; тест старого Node пропускается на поддерживаемом Node; код выхода — 0

#### Scenario S-5: Матрица CI

- **Given** pull request в `trunk`
- **When** запускается CI на `ubuntu-24.04`, `macos-26`, `windows-2025` с Node `24.22.2` и `26.13.0`
- **Then** в каждой из шести ячеек проходят `npm ci`, `npm test` и `npm run typecheck`; ни одна ячейка не отменяется из-за падения другой

#### Scenario S-6: Путь с пробелом и кириллицей

- **Given** копия инструмента лежит в каталоге, имя которого содержит пробел и кириллицу
- **When** выполняется `node bin/vf.mjs --version` из этого каталога
- **Then** печатается версия и код выхода — 0

#### Scenario S-7: Манифест без рантайм-зависимостей

- **Given** рабочее дерево после `npm ci`
- **When** выполняется `npm ls --omit=dev`
- **Then** список пуст, `bin.vf` указывает на существующий `./bin/vf.mjs`

#### Scenario S-8: README

- **Given** открыт `README.md`
- **When** читатель ищет требования и команду запуска
- **Then** находит Node `>= 24.22.2` и `node bin/vf.mjs --version`

#### Scenario S-9: Красное свидетельство до реализации

- **Given** тесты написаны, реализация ещё отсутствует
- **When** выполняется `node --test`
- **Then** тесты падают, вывод и коды выхода записаны в `T-0001_impl.md`; после реализации тот же прогон проходит

### Expected behavior

- `bin/vf.mjs` начинается с shebang, использует LF, на Unix имеет исполняемый бит и не содержит типов TypeScript.
- Проверка версии сравнивает числовые компоненты `major.minor.patch`; отсутствующие компоненты считаются нулями; версия с суффиксом пред-релиза ниже той же версии без суффикса.
- При неподдерживаемой версии сообщение идёт в stderr, stdout пуст, код выхода — 1; динамический импорт `src/cli.ts` не выполняется.
- На поддерживаемом Node `bin/vf.mjs` динамически импортирует `src/cli.ts`, вызывает `main(process.argv.slice(2))` и завершается с кодом, который вернул `main`.
- `src/cli.ts` экспортирует `main(argv: string[]): number`; распознаётся только `--version` как единственный аргумент; отсутствие команды и неизвестный аргумент дают код 2.
- `--version` печатает `viaferrata ` и значение `version` из `package.json`.
- `node --test` запускается без аргументов; тесты — `test/**/*.test.ts`, проверка старого Node — отдельный `.mjs`-тест, который пропускается на поддерживаемом Node.
- `tsc --noEmit` проверяет `src/**/*.ts` и `test/**/*.ts`; `bin/*.mjs` не типизируется. CI-задача `old-node` запускает только тест старого Node на Node `22.12.0` командой `node --test test/old-node.test.mjs`; `clean-machine` не устанавливает dev-зависимости и не запускает `tsc`.

### Definition of Done

- Все AC проходят: шесть ячеек матрицы, `old-node` и `clean-machine` зелёные в CI.
- Локально в WSL2 проходят `npm ci`, `npm test`, `npm run typecheck`.
- В `package.json` нет `dependencies`; новые зависимости — только dev: TypeScript и `@types/node`; `package-lock.json` закоммичен и `npm ci` воспроизводим.
- В PR 2 `README.md` обновлён; `.gitattributes`, `.gitignore`, `AGENTS.md` и `work/templates/**` не менялись.
- `T-0001_impl.md` содержит красное свидетельство, таблицу AC, статус `in-progress` и «Уточнения» о ручном процессе.
- Файл спецификации в PR 2 не изменён; изменения не выходят за `scope`.
- Один коммит в Conventional Commits на английском; слияние PR 2 — Rebase and merge.

## Plan

### Layers

1. **Границы и инвентарь.** Зафиксировать список файлов и пути `scope`; проверить, что `.gitattributes` и `.gitignore` уже соответствуют.
2. **Сценарии успеха и ошибки.** Использовать S-1–S-9 как контракт проверок; ничего не добавлять сверх них.
3. **Контракт.** Определить поверхность CLI (`--version`, коды 0/1/2), формат сообщений, порядок «проверка версии → импорт `src/cli.ts`», единый источник минимальной версии.
4. **Структуры и типы.** `main(argv: string[]): number`, компаратор версий в чистом JS и его объявление типов, `tsconfig` с флагами из Constraints; `@types/node` для типов `node:test`.
5. **Тесты до реализации.** Написать `test/**/*.test.ts` и `test/old-node.test.mjs`; прогнать `node --test` до реализации, записать красное свидетельство в `T-0001_impl.md`.
6. **Реализация.** `package.json` и lock, `tsconfig.json`, `.node-version`, `bin/vf.mjs` и компаратор, `src/cli.ts`, CI-workflow, README.
7. **Проверка.** `npm ci`, `npm test`, `npm run typecheck` локально; прогнать CI, `old-node`, `clean-machine` и тест пути с пробелом и кириллицей; записать результаты AC.
8. **Стабилизация.** Исправлять только расхождения со сценариями и падения CI; улучшения структуры не делать.
9. **Рефакторинг.** Отдельно и после стабилизации; в объём T-0001 не входит.

### Applicable ADRs

- `ADR-0001` — процесс, два PR, ветки, диалект глобов.
- `ADR-0002` — Node `>= 24.22.2`, ESM, стирание типов, входная точка на JS.
- `ADR-0003` — Linux, macOS, Windows; матрица CI; границы доказательства.
- `ADR-0004` — контракт `bin/vf.mjs`, отсутствие рантайм-зависимостей, `private` до релиза.
- `ADR-0005` — шапка и структура этой спецификации.
