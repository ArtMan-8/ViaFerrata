import fs from 'node:fs/promises';
import path from 'node:path';
import { loadConfig } from './config.js';
import { inspectDocuments } from './documents.js';
import { createChange } from './new.js';
import { CommandError, diagnostic, exitCode, formatDiagnostic } from './diagnostics.js';

const help = `ViaFerrata — создание change и базовая формальная проверка

vf --help
vf --version
vf [--root PATH] new "Название задачи"
vf [--root PATH] validate

Корень по умолчанию — cwd, без поиска родителей. Нужен viaferrata.toml.
new создаёт три draft-документа по библиотечным формам с optional-подсказками.
validate проверяет базовую структуру, ID и существование ссылок, без изменения файлов.
Полная поддержка lite/strict, init, evidence и контроль завершения пока отсутствуют.
`;
export const limitations = 'Не проверены: смысл и матрица отношений, покрытие, scope/protected_paths по diff, согласование, evidence и завершение. Полная поддержка lite/strict отсутствует.';

function argumentsFor(argv) {
  if (!argv.length || argv.length === 1 && argv[0] === '--help') return { command: 'help' };
  if (argv.length === 1 && argv[0] === '--version') return { command: 'version' };
  const args = [...argv];
  let root = process.cwd();
  if (args[0] === '--root') {
    args.shift();
    root = args.shift();
    if (!root || root.startsWith('--')) throw new CommandError('E_USAGE', 'Укажите путь после --root; см. vf --help.', 'vf');
  }
  const [command, title] = args;
  if (command === 'validate' && args.length === 1) return { command, root };
  if (command === 'new' && args.length === 2 && !title.startsWith('--') && title.trim() && !/[\r\n]/.test(title)) return { command, root, title };
  throw new CommandError('E_USAGE', 'Неверная команда, флаг или аргументы; см. vf --help.', 'vf');
}

export async function main(argv = process.argv.slice(2), output = console) {
  let root = process.cwd();
  let validating = false;
  try {
    if (Number(process.versions.node.split('.')[0]) !== 24) throw new CommandError('E_RUNTIME', 'Поддерживается Node.js 24.x; используйте этот runtime.', 'vf');
    const args = argumentsFor(argv);
    validating = args.command === 'validate';
    if (args.command === 'help') { output.log(help); return 0; }
    if (args.command === 'version') {
      const pkg = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8'));
      output.log(pkg.version); return 0;
    }
    root = path.resolve(args.root);
    const config = await loadConfig(root);
    if (args.command === 'new') {
      const result = await createChange(config, args.title);
      for (const item of result.diagnostics) output.error(formatDiagnostic(item));
      if (result.id) output.log(`Создан ${result.id}: intent.md, spec.md, plan.md. Черновик требует заполнения; Journal не создан.\n${path.relative(root, path.join(config.directories.changes, result.id))}`);
      return exitCode(result.diagnostics);
    }
    const result = await inspectDocuments(config);
    for (const item of result.diagnostics) output.error(formatDiagnostic(item));
    const code = exitCode(result.diagnostics);
    const errors = result.diagnostics.filter(d => d.severity === 'error').length;
    output.log(`Корень: ${root}\nПрофиль: ${config.profile}\nДокументов: ${result.documents.length}; ошибок: ${errors}; предупреждений: ${result.diagnostics.length - errors}.`);
    output.log('Охват: YAML/метаданные, ID/размещение, базовые разделы/объявления, существование ссылок.');
    output.log(code === 2 ? 'Неполный охват: проверка не завершена.' : code === 1 ? 'Обнаружены ошибки базовой структуры.' : 'Базовая структура проверена.');
    if (!result.documents.length) output.log('Документов нет; это не подтверждает готовность проекта.');
    output.log(limitations);
    return code;
  } catch (error) {
    const d = diagnostic(path.isAbsolute(error.file ?? '') ? path.relative(root, error.file) : error.file ?? 'vf', error instanceof CommandError ? error.code : 'E_IO', error instanceof CommandError ? error.message : `Не удалось выполнить команду: ${error.message}; проверьте окружение и пакет.`);
    output.error(formatDiagnostic(d));
    if (validating) {
      output.log(`Корень: ${root}\nПрофиль: не установлен из-за ошибки.\nДокументов: 0; проход не выполнен.\nНеполный охват: проверка не завершена.\n${limitations}`);
    }
    return 2;
  }
}
