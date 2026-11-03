# T-0001: Журнал реализации

Статус: `in-progress`.

Ветка: `impl/T-0001_toolchain-skeleton`. Спецификация [`T-0001_spec.md`](./T-0001_spec.md) изменена по решению мейнтейнера: из AC-9 и S-8 убрано требование ссылки на установку Node, дата обновлена на 2026-11-03.

`vf check` и `vf red` ещё не существуют, поэтому проверки и красное свидетельство ведутся вручную.

## Red evidence

Тесты по AC и сценариям написаны до реализации; исходный прогон до реализации дал код `1` и 5 падений из 5. После него внешний форматтер переформатировал тесты (кавычки и переносы) без изменения семантики, поэтому ниже — повторное воспроизведение красного состояния с текущими файлами тестов: реализация (`package.json`, `tsconfig.json`, `.node-version`, `package-lock.json`, `bin/`, `src/`) временно убрана, затем восстановлена из индекса.

Команда:

```sh
node --test
```

Код выхода: `1`.

Хэши текущих тестов (`sha256sum test/*.test.ts test/old-node.test.mjs`):

```text
4cbfaa8c19d971cad911b9999a13b4f080d841dc95c3e2b490cc773af752fd6a  test/cli.test.ts
0929df893199bc2b130fdf34ba43fd3eb4dab834d7c580a6a32e04241c530d03  test/package.test.ts
ff1371eb4b4649510188c2ea5c834a22782caf356980df3641022674188bb2bd  test/path.test.ts
a15459bc8ebb1c06f7caa05c1ad956c9d10a984961bab312c4a77290882b8625  test/version.test.ts
33564a6a737002ea56b67f1e2c72d2baab970111e80dd33ee51cfed408d044c7  test/old-node.test.mjs
```

Литеральный вывод:

```text
node:fs:483
    return binding.readFileUtf8(path, stringToFlags(options.flag));
                   ^

Error: ENOENT: no such file or directory, open '/home/art/projects/ViaFerrata/package.json'
    at readFileSync (node:fs:483:20)
    at file:///home/art/projects/ViaFerrata/test/cli.test.ts:11:5
    at ModuleJob.run (node:internal/modules/esm/module_job:561:25)
    at async node:internal/modules/esm/loader:647:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5) {
  errno: -2,
  code: 'ENOENT',
  syscall: 'open',
  path: '/home/art/projects/ViaFerrata/package.json'
}

Node.js v24.22.2
✖ test/cli.test.ts (136.520432ms)
node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/art/projects/ViaFerrata/bin/version.mjs' imported from /home/art/projects/ViaFerrata/test/old-node.test.mjs
    at finalizeResolution (node:internal/modules/esm/resolve:272:11)
    at moduleResolve (node:internal/modules/esm/resolve:879:10)
    at defaultResolve (node:internal/modules/esm/resolve:1006:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:705:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:725:38)
    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:763:56)
    at #resolve (node:internal/modules/esm/loader:687:17)
    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:607:35)
    at ModuleJob.syncLink (node:internal/modules/esm/module_job:276:33)
    at ModuleJob.link (node:internal/modules/esm/module_job:381:17) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/art/projects/ViaFerrata/bin/version.mjs'
}

Node.js v24.22.2
✖ test/old-node.test.mjs (63.431246ms)
node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/art/projects/ViaFerrata/bin/version.mjs' imported from /home/art/projects/ViaFerrata/test/package.test.ts
    at finalizeResolution (node:internal/modules/esm/resolve:272:11)
    at moduleResolve (node:internal/modules/esm/resolve:879:10)
    at defaultResolve (node:internal/modules/esm/resolve:1006:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:705:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:725:38)
    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:763:56)
    at #resolve (node:internal/modules/esm/loader:687:17)
    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:607:35)
    at ModuleJob.syncLink (node:internal/modules/esm/module_job:276:33)
    at ModuleJob.link (node:internal/modules/esm/module_job:381:17) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/art/projects/ViaFerrata/bin/version.mjs'
}

Node.js v24.22.2
✖ test/package.test.ts (129.163932ms)
✖ AC-8: --version works from a path with a space and Cyrillic (8.485984ms)
node:internal/modules/esm/resolve:272
    throw new ERR_MODULE_NOT_FOUND(
          ^

Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/home/art/projects/ViaFerrata/bin/version.mjs' imported from /home/art/projects/ViaFerrata/test/version.test.ts
    at finalizeResolution (node:internal/modules/esm/resolve:272:11)
    at moduleResolve (node:internal/modules/esm/resolve:879:10)
    at defaultResolve (node:internal/modules/esm/resolve:1006:11)
    at #cachedDefaultResolve (node:internal/modules/esm/loader:705:20)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:725:38)
    at ModuleLoader.resolveSync (node:internal/modules/esm/loader:763:56)
    at #resolve (node:internal/modules/esm/loader:687:17)
    at ModuleLoader.getOrCreateModuleJob (node:internal/modules/esm/loader:607:35)
    at ModuleJob.syncLink (node:internal/modules/esm/module_job:276:33)
    at ModuleJob.link (node:internal/modules/esm/module_job:381:17) {
  code: 'ERR_MODULE_NOT_FOUND',
  url: 'file:///home/art/projects/ViaFerrata/bin/version.mjs'
}

Node.js v24.22.2
✖ test/version.test.ts (123.098927ms)
ℹ tests 5
ℹ suites 0
ℹ pass 0
ℹ fail 5
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 189.907024

✖ failing tests:

test at test/cli.test.ts:1:1
✖ test/cli.test.ts (136.520432ms)
  'test failed'

test at test/old-node.test.mjs:1:1
✖ test/old-node.test.mjs (63.431246ms)
  'test failed'

test at test/package.test.ts:1:1
✖ test/package.test.ts (129.163932ms)
  'test failed'

test at test/path.test.ts:9:1
✖ AC-8: --version works from a path with a space and Cyrillic (8.485984ms)
  Error: ENOENT: no such file or directory, lstat '/home/art/projects/ViaFerrata/bin'
      at async lstat (node:internal/fs/promises:1741:18)
      at async Promise.all (index 0)
      at async checkPaths (node:internal/fs/cp/cp:77:39)
      at async cpFn (node:internal/fs/cp/cp:66:17)
      at async TestContext.<anonymous> (file:///home/art/projects/ViaFerrata/test/path.test.ts:15:7)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async startSubtestAfterBootstrap (node:internal/test_runner/harness:387:3) {
    errno: -2,
    code: 'ENOENT',
    syscall: 'lstat',
    path: '/home/art/projects/ViaFerrata/bin'
  }

test at test/version.test.ts:1:1
✖ test/version.test.ts (123.098927ms)
  'test failed'
```

## Green evidence

Зелёный прогон выполнен на тех же файлах тестов, что и красное воспроизведение (хэши выше).

Команды и коды выхода:

```text
npm ci            -> 0
npm test          -> 0
npm run typecheck -> 0
npm ls --omit=dev -> 0 (viaferrata@0.0.0, дерево зависимостей пустое)
```

`npm test` (`node --test` без аргументов) — итог:

```text
ℹ tests 14
ℹ suites 0
ℹ pass 13
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
```

Пропущен один тест — `AC-4` на поддерживаемом Node 24.22.2.

### Old Node

Node 22.12.0 через nvm:

```text
$ node --test test/old-node.test.mjs
1..1
# tests 1
# pass 1
# fail 0

$ node bin/vf.mjs --version
viaferrata requires Node.js >= 24.22.2; current is 22.12.0. Install Node.js: https://nodejs.org/en/download
$ echo $?
1
```

stdout пуст (0 байт), сообщение — одна строка в stderr, `ERR_UNKNOWN_FILE_EXTENSION` отсутствует.

### Clean machine

Docker локально недоступен, поэтому сценарий без `node_modules` воспроизведён переносом каталога:

```text
$ mv node_modules /tmp/vf-nm-backup2
$ node --version
v24.22.2
$ node --test
ℹ tests 14
ℹ pass 13
ℹ fail 0
ℹ skipped 1
$ echo $?
0
$ node bin/vf.mjs --version
viaferrata 0.0.0
$ echo $?
0
$ mv /tmp/vf-nm-backup2 node_modules
```

CI-задача `clean-machine` выполняет те же команды в контейнере `node:24.22.2-bookworm`.

### CLI

```text
$ node bin/vf.mjs --version
viaferrata 0.0.0
$ echo $?
0
$ node bin/vf.mjs
vf: no command given; try "vf --version"
$ echo $?
2
$ node bin/vf.mjs --unknown
vf: unknown option "--unknown"; try "vf --version"
$ echo $?
2
```

Для всех трёх вызовов stdout и stderr разведены: у кода 0 stdout — 17 байт, stderr пуст; у кодов 2 stdout пуст, stderr — 41 и 51 байт соответственно.

## Acceptance Criteria

| AC    | Результат                           | Свидетельство                                                                                                          |
| ----- | ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| AC-1  | pass                                | `test/package.test.ts` в `npm test`; `npm ls --omit=dev` — `(empty)`                                                   |
| AC-2  | pass                                | `test/package.test.ts` проверяет флаги и `include`; `npm run typecheck` — код 0                                        |
| AC-3  | pass                                | `test/cli.test.ts`; ручные вызовы выше: коды 0/2/2, потоки соответствуют спеке                                         |
| AC-4  | pass                                | Node 22.12.0: `test/old-node.test.mjs` — код 0, CLI — код 1 и одна строка в stderr                                     |
| AC-5  | pass                                | `node --test` без аргументов: 14 тестов, 13 pass, 1 skipped, код 0                                                     |
| AC-6  | ожидает CI                          | Матрица 3 × 2 настроена; прогон возможен после пуша ветки и создания PR                                                |
| AC-7  | локальная имитация pass, ожидает CI | `node --test` и CLI без `node_modules` — коды 0; CI-задача `clean-machine` в `node:24.22.2-bookworm`                   |
| AC-8  | pass                                | `test/path.test.ts` копирует инструмент в каталог с пробелом и кириллицей, `--version` — код 0                         |
| AC-9  | pass (manual)                       | В `README.md` есть Node `>= 24.22.2` и `node bin/vf.mjs --version`                                                     |
| AC-10 | pass                                | В этом файле есть красное свидетельство, статус `in-progress`, таблица AC и раздел `Clarifications` про ручной процесс |

## Clarifications

- «Уточнения» в смысле AC-10: команд `vf check` и `vf red` ещё нет, поэтому красное свидетельство и проверки AC собраны вручную и записаны в этом файле.
- AC-2 проверяется тестом на содержимое `tsconfig.json`; фактический проход `tsc --noEmit` подтверждается отдельной командой `npm run typecheck` и не может быть запущен из `node --test` без `node_modules` (требование AC-7).
- AC-6 и CI-часть AC-7 подтверждаются после пуша ветки и запуска GitHub Actions. Локально Docker недоступен, поэтому clean-machine воспроизведён переносом `node_modules`; старый Node проверен через nvm.
- По решению мейнтейнера из `T-0001_spec.md` убрано требование ссылки на установку Node в AC-9 и S-8; дата спецификации обновлена на 2026-11-03. Сообщение CLI для старого Node по-прежнему содержит ссылку на установку, как в примере спеки.
- Исходные тесты были переформатированы внешним инструментом после первого красного прогона; семантика не менялась. Красное свидетельство выше воспроизведено с текущими файлами, поэтому его хэши совпадают с зелёным прогоном.
