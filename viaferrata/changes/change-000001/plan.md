---
id: change-000001/plan
status: approved
execution: completed
created: "2026-11-12"
updated: "2026-11-12"
---

# Реализация и проверка первого CLI

## Technical Approach

JavaScript ESM без сборщика; точка входа bin/vf.js и модули конфигурации, чтения/индекса документов, генерации и диагностики в src. Схемы заданы таблицами; YAML/TOML/Markdown разбираются библиотеками. Чтение и диагностика не пишут в проект; запись отделена в new и проверяется управляемыми отказами файловых операций.

Проверки используют независимые фикстуры, subprocess, сравнение файлов и установку tarball с новым кешем. Исходный каталог упаковки недоступен установленному CLI. Семь форм и инструкции принадлежат пакету; проектные документы и docs/GLOSSARY.md в поставку не входят. Диагностический scripts/input-manifest.js не пишет в проект.

## Steps

### W-1: CLI, документы и проверка

Execution: sequential

- [x] P-1: Подготовить согласованный комплект, Journal и viaferrata.toml с профилем lite и корнем документов viaferrata/.
  - Covers:
    - [change-000001/spec/R-2]
    - [change-000001/spec/R-7]
  - Verification: сверить конфигурацию, основание согласования, принятое содержание и ограничения восстановления редакции.

- [x] P-2: Подготовить npm-пакет, help/version, диагностику аргументов и определение корня проекта.
  - Covers:
    - [change-000001/spec/R-1]
    - [change-000001/spec/R-2]
  - Verification: tests/cli.test.js по AC-1–2 Intent; запуск из постороннего cwd, сравнение версии с package.json и деревьев целевого и соседнего проектов.

- [x] P-3: Реализовать индекс документов и validate с независимыми проверками метаданных, структуры, ссылок и пограничных случаев.
  - Covers:
    - [change-000001/spec/R-4]
    - [change-000001/spec/R-5]
    - [change-000001/spec/R-6]
    - [change-000001/spec/R-7]
    - [change-000001/spec/R-10]
  - Verification: tests/validation.test.js, tests/ids.test.js и cases.json по AC-4–6, AC-10 Intent; сравнить байты и mtime после повторного validate.

- [x] P-4: Реализовать new с шестизначными ID, подстановкой параметров форм и созданием файлов без перезаписи.
  - Covers:
    - [change-000001/spec/R-3]
    - [change-000001/spec/R-8]
  - Verification: tests/cli.test.js и tests/ids.test.js по AC-3 Intent; прямые ожидания содержимого, диапазон 000001–999999, E_EXISTS, E_ID_EXHAUSTED, сохранность чужих файлов и управляемый сбой после первой записи.

- [x] P-7: Подготовить семь библиотечных форм, локальные правила, руководства, глоссарий и навигацию.
  - Covers:
    - [change-000001/spec/R-8]
    - [change-000001/spec/R-9]
  - Verification: tests/library.test.js и tests/documentation.test.js; ручная сверка форм, метаданных, optional-подсказок, терминов и ссылок с контрактом. Проверить самодостаточность поставляемых руководств и отсутствие зависимости от исключённого docs/GLOSSARY.md.

- [x] P-5: Проверить состав и установку tarball с новым изолированным кешем и запуск установленного CLI.
  - Covers:
    - [change-000001/spec/R-8]
    - [change-000001/spec/R-11]
  - Verification: tests/package.test.js по AC-7 и AC-11 Intent: временная копия источника, исходный checkout не перемещается. Проверить ошибку черновика и успех независимого заполненного образца; очистить временные каталоги.

- [x] P-9: Подготовить необязательную диагностику входов scripts/input-manifest.js.
  - Covers:
    - [change-000001/spec/R-12]
  - Verification: tests/manifest.test.js; сверить состав входов, детерминированность, изменение отпечатка при изменении байтов и отсутствие записи в проект.

- [x] P-6: Выполнить обязательные проверки, сверить результат и scope, сохранить итог в Journal.
  - Covers:
    - [change-000001/intent/AC-1]
    - [change-000001/intent/AC-2]
    - [change-000001/intent/AC-3]
    - [change-000001/intent/AC-4]
    - [change-000001/intent/AC-5]
    - [change-000001/intent/AC-6]
    - [change-000001/intent/AC-7]
    - [change-000001/intent/AC-8]
    - [change-000001/intent/AC-9]
    - [change-000001/intent/AC-10]
    - [change-000001/intent/AC-11]
  - Verification: npm ci с новым кешем, npm test, node bin/vf.js --root . validate, git diff --check, git diff --cached --check, git status --short и ручная сверка tracked/untracked со scope. Записать команды, среду, проверенные входы, фактические результаты и ограничения. После записи итога повторить затронутые проверки документов; completed допустим только при успешном обязательном наборе.
