import fs from 'node:fs/promises';
import path from 'node:path';
import { parseDocument, visit, isAlias, isScalar, isSeq, isMap } from 'yaml';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { categories } from './config.js';
import { diagnostic, sortDiagnostics } from './diagnostics.js';
import { identity, addressIdentity, statuses, executions, requiredHeadings, localTypes } from './schema.js';

const parser = unified().use(remarkParse);
const ignored = new Set(['code', 'inlineCode', 'html', 'blockquote', 'definition', 'link', 'linkReference', 'image', 'imageReference']);
const fieldNames = new Set(['id', 'status', 'execution', 'created', 'updated', 'scope', 'origin', 'research', 'adr', 'supersedes']);
const expectedSection = { AC: 'Acceptance Criteria', R: 'Requirements', S: 'Scenarios', DOD: 'Definition of Done', W: 'Steps', P: 'Steps', V: 'Verification and Result' };

function point(raw, offset) {
  const prefix = raw.slice(0, offset);
  return { line: prefix.split('\n').length, column: offset - prefix.lastIndexOf('\n') };
}
function plain(node) { return node.value ?? (node.children ?? []).map(plain).join(''); }

async function discover(config, diagnostics) {
  const files = [];
  const changeDirectories = [];
  async function walk(directory, category) {
    let entries;
    try { entries = await fs.readdir(directory, { withFileTypes: true }); }
    catch (error) {
      if (error.code === 'ENOENT') return;
      diagnostics.push(diagnostic(path.relative(config.root, directory), 'E_IO', `${error.message}; проверьте доступ к каталогу.`));
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        diagnostics.push(diagnostic(path.relative(config.root, absolute), 'E_UNSUPPORTED', 'Симлинки в каталогах документов не поддерживаются; используйте обычные файлы и каталоги.'));
      } else if (entry.isDirectory()) {
        if (directory === config.directories.changes && identity(`${entry.name}/intent`)?.change === entry.name) changeDirectories.push(entry.name);
        if (!['.git', '.viaferrata', 'node_modules'].includes(entry.name)) await walk(absolute, category);
      } else if (entry.isFile() && entry.name.endsWith('.md')) files.push({ absolute, category });
    }
  }
  for (const category of categories) await walk(config.directories[category], category);
  return { files, changeDirectories };
}

function readMetadata(doc, diagnostics, indexOnly) {
  const { raw, file } = doc;
  doc.add = (code, message, offset = 0) => {
    const p = point(raw, offset);
    diagnostics.push(diagnostic(file, code, message, p.line, p.column));
  };
  const match = /^(?:\uFEFF)?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(raw);
  if (!match) { doc.add('E_YAML', 'Нет закрытого YAML front matter в начале файла; добавьте строки --- и метаданные.'); return; }
  doc.frontEnd = match[0].length;
  const start = raw.indexOf('\n') + 1;
  const yaml = parseDocument(match[1], { version: '1.2', uniqueKeys: true });
  for (const error of yaml.errors) doc.add('E_YAML', `${error.message}; исправьте YAML.`, start + (error.pos?.[0] ?? 0));
  if (yaml.errors.length) return;
  let unsupported = false;
  visit(yaml, (key, node) => {
    if (isAlias(node) || node?.anchor || (node?.tag && !node.tag.startsWith('tag:yaml.org,2002:'))
      || (key === 'key' && isScalar(node) && node.value === '<<')) unsupported = true;
  });
  if (unsupported || yaml.warnings.length || yaml.directives.yaml.version !== '1.2') { doc.add('E_UNSUPPORTED', 'Требуется YAML 1.2 без tags, anchors, aliases и merge keys; запишите обычные значения.', start); return; }
  if (!isMap(yaml.contents)) { doc.add('E_YAML', 'Front matter должен быть mapping; используйте поля key: value.', start); return; }
  doc.metadata = yaml.toJS();
  doc.identity = identity(doc.metadata.id);
  const nodeFor = key => yaml.get(key, true);
  const offsetFor = key => start + (nodeFor(key)?.range?.[0] ?? 0);
  doc.field = (key, code, message) => doc.add(code, message, offsetFor(key));
  if (!doc.identity) { doc.field('id', 'E_ID', 'id отсутствует или не соответствует формату ViaFerrata; задайте полный ID.'); return; }
  if (indexOnly) return;
  const { type } = doc.identity;
  for (const key of Object.keys(doc.metadata)) {
    if (['type', 'kind', 'change_id'].includes(key)) doc.field(key, 'E_FIELD', `${key} запрещён; тип и change определяются из id.`);
    else if (!fieldNames.has(key)) doc.field(key, 'W_UNKNOWN_FIELD', `Неизвестное поле ${key}: сохранено, не интерпретировано; проверьте назначение или написание.`);
  }
  for (const key of ['created', 'updated']) {
    const value = doc.metadata[key];
    const node = nodeFor(key);
    const valid = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
      && ['QUOTE_DOUBLE', 'QUOTE_SINGLE'].includes(node?.type)
      && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!valid) doc.field(key, 'E_DATE', `${key} должен содержать реальную дату YYYY-MM-DD в кавычках.`);
  }
  if (typeof doc.metadata.updated === 'string' && typeof doc.metadata.created === 'string' && doc.metadata.updated < doc.metadata.created) doc.field('updated', 'E_DATE', 'updated раньше created; исправьте дату.');
  for (const key of ['status', 'execution']) {
    const required = key === 'status' ? type !== 'journal' : type === 'plan';
    const value = doc.metadata[key];
    if (!required && value !== undefined) doc.field(key, 'E_FIELD', `${key} не разрешён для ${type}; удалите поле.`);
    if (required && typeof value !== 'string') doc.field(key, 'E_FIELD', `Требуется строковое поле ${key}.`);
    else if (required) {
      const values = key === 'execution' ? executions : type === 'research' ? ['draft', 'completed', 'superseded', 'cancelled'] : statuses;
      if (!values.includes(value)) doc.field(key, 'E_ENUM', `${key}: допустимо ${values.join(', ')}.`);
    }
  }
  for (const key of ['scope', 'origin', 'research', 'adr', 'supersedes']) {
    if (!(key in doc.metadata)) continue;
    if (key === 'scope' && type !== 'spec') doc.field(key, 'E_FIELD', 'scope разрешён только в задачной Spec.');
    if (key === 'supersedes' && !['intent', 'research', 'adr'].includes(type)) doc.field(key, 'E_UNSUPPORTED', `supersedes для ${type} не поддерживается.`);
    const node = nodeFor(key);
    const values = doc.metadata[key];
    if (!isSeq(node) || !Array.isArray(values) || !values.length || values.some(v => typeof v !== 'string' || !v.trim()) || (key !== 'scope' && node.flow)) {
      doc.field(key, 'E_FIELD', `${key} должен быть непустым массивом строк${key === 'scope' ? '' : ' через дефисы'}; исправьте форму.`);
      continue;
    }
    if (key !== 'scope') values.forEach((value, i) => doc.references.push({ value, key, offset: start + (node.items[i]?.range?.[0] ?? 0) }));
  }
}

function readMarkdown(doc) {
  const source = doc.raw.slice(0, doc.frontEnd).replace(/[^\r\n]/g, ' ') + doc.raw.slice(doc.frontEnd);
  const tree = parser.parse(source);
  const events = [];
  const htmlStack = [];
  const voidTags = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
  function visitNode(node) {
    if (node.type === 'html') {
      const html = node.value.replace(/<!--[\s\S]*?-->/g, '');
      for (const tag of html.matchAll(/<(\/?)([a-z][\w-]*)\b[^>]*?(\/?)>/gi)) {
        const name = tag[2].toLowerCase();
        if (tag[1]) {
          const index = htmlStack.lastIndexOf(name);
          if (index >= 0) htmlStack.splice(index);
        } else if (!tag[3] && !voidTags.has(name)) htmlStack.push(name);
      }
      return;
    }
    if (ignored.has(node.type)) return;
    if (!htmlStack.length && ['heading', 'listItem', 'paragraph', 'text'].includes(node.type)) events.push(node);
    for (const child of node.children ?? []) visitNode(child);
  }
  visitNode(tree);
  events.sort((a, b) => a.position.start.offset - b.position.start.offset);
  const headings = events.filter(n => n.type === 'heading');
  const h1 = headings.filter(n => n.depth === 1);
  if (h1.length !== 1 || !plain(h1[0]).trim()) doc.add('E_STRUCTURE', 'Требуется один непустой H1; исправьте заголовок.');
  for (const name of requiredHeadings[doc.identity.type]) {
    if (headings.filter(n => n.depth === 2 && plain(n) === name).length !== 1) doc.add('E_STRUCTURE', `Требуется один H2 ${name}; добавьте раздел или удалите дубликат.`);
  }
  let section = '';
  let subsection = '';
  let wave = null;
  const waves = [];
  const ac = [];
  function declare(id, node, group) {
    if (doc.locals.has(id)) doc.add('E_DUPLICATE_LOCAL_ID', `Повтор ${id}; сохраните уникальные локальные ID.`, node.position.start.offset);
    else doc.locals.add(id);
    if (!localTypes[doc.identity.type].includes(group) || expectedSection[group] !== section) doc.add('E_STRUCTURE', `${id} недопустим в этом типе/разделе; перенесите объявление.`, node.position.start.offset);
  }
  for (const node of events) {
    const offset = node.position.start.offset;
    if (node.type === 'heading') {
      const title = plain(node);
      if (node.depth === 2) { section = title; subsection = ''; wave = null; }
      if (node.depth === 3) subsection = title;
      // An ID presented entirely as inline code is an example, not a declaration.
      const first = node.children?.[0];
      if (first?.type !== 'text' || !/^(AC|R|S|DOD|W|P|V)-/.test(first.value)) continue;
      const m = /^(AC|R|S|DOD|W|P|V)-([1-9]\d*):\s+\S/.exec(title);
      if (!m || node.depth !== (m[1] === 'V' ? 4 : 3) || m[1] === 'P') { doc.add('E_STRUCTURE', 'Некорректное локальное объявление; исправьте ID, уровень или название.', offset); continue; }
      const group = m[1];
      const id = `${group}-${m[2]}`;
      declare(id, node, group);
      if (group === 'V' && subsection !== 'Verification') doc.add('E_STRUCTURE', 'V должен находиться в подразделе Verification.', offset);
      if (group === 'AC') ac.push({ node, id });
      if (group === 'W') { wave = { node, count: 0, execution: [] }; waves.push(wave); }
    }
    if (node.type === 'listItem') {
      const firstLine = source.slice(offset, node.position.end.offset).split(/\r?\n/)[0];
      if (/^- \[[ x]\] P-/.test(firstLine)) {
        const m = /^- \[[ x]\] (P-[1-9]\d*):\s+\S/.exec(firstLine);
        if (!m) doc.add('E_STRUCTURE', 'Некорректный P-ID или пустой шаг; исправьте объявление.', offset);
        else {
          declare(m[1], node, 'P');
          if (!wave) doc.add('E_STRUCTURE', 'Шаг должен находиться в волне W; добавьте волну.', offset);
          else wave.count++;
        }
      } else if (/^(?:[-+*]|\d+[.)])\s+(?:\[[^\]]*\]\s+)?P-/.test(firstLine)) doc.add('E_STRUCTURE', 'Шаг объявляется как - [ ] P-N: текст или - [x] P-N: текст.', offset);
    }
    if (node.type === 'paragraph' && wave && /^Execution:/.test(plain(node))) wave.execution.push(plain(node));
    if (node.type !== 'text') continue;
    // Use source ranges so escaped brackets remain distinguishable from real links.
    const rawText = source.slice(offset, node.position.end.offset);
    if (node.value.includes('TODO(VF)')) doc.add('E_DRAFT_PLACEHOLDER', 'Осталась заготовка TODO(VF); заполните или удалите неприменимый блок.', offset);
    const brackets = /\[((?:change|srs|research|adr)-[^\]\r\n]*)\]/g;
    for (const m of rawText.matchAll(brackets)) {
      let backslashes = 0;
      for (let i = m.index - 1; i >= 0 && rawText[i] === '\\'; i--) backslashes++;
      if (backslashes % 2) continue;
      doc.references.push({ value: m[1], offset: offset + m.index });
    }
  }
  if (doc.identity.type === 'intent') {
    if (!ac.length) doc.add('E_STRUCTURE', 'Требуется хотя бы один AC с Verification.');
    for (const item of ac) {
      const end = headings.find(n => n.position.start.offset > item.node.position.start.offset && n.depth <= 3)?.position.start.offset ?? source.length;
      const hasVerification = events.some(n => n.type === 'listItem' && n.position.start.offset > item.node.position.start.offset && n.position.start.offset < end && /^- Verification:\s+\S/.test(source.slice(n.position.start.offset, n.position.end.offset)));
      if (!hasVerification) doc.add('E_STRUCTURE', `${item.id} требует непустой Verification; укажите способ проверки.`, item.node.position.start.offset);
    }
  }
  if (doc.identity.type === 'srs' && ![...doc.locals].some(id => id.startsWith('R-'))) doc.add('E_STRUCTURE', 'SRS требует хотя бы одно R; добавьте требование.');
  if (doc.identity.type === 'plan') {
    if (!waves.length) doc.add('E_STRUCTURE', 'Plan требует хотя бы одну волну W.');
    for (const w of waves) {
      if (!w.count || w.execution.length !== 1 || !['Execution: sequential', 'Execution: parallel'].includes(w.execution[0])) doc.add('E_STRUCTURE', 'Каждая волна требует Execution: sequential/parallel и хотя бы один шаг.', w.node.position.start.offset);
    }
  }
}

export async function inspectDocuments(config, { indexOnly = false } = {}) {
  const diagnostics = [];
  const documents = [];
  const { files, changeDirectories } = await discover(config, diagnostics);
  for (const entry of files) {
    const file = path.relative(config.root, entry.absolute);
    let raw;
    try { raw = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fs.readFile(entry.absolute)); }
    catch (error) { diagnostics.push(diagnostic(file, 'E_IO', `${error.message}; проверьте доступ и UTF-8.`)); continue; }
    const doc = { ...entry, file, raw, references: [], locals: new Set() };
    documents.push(doc);
    readMetadata(doc, diagnostics, indexOnly);
    if (doc.identity && !indexOnly) {
      const expectedCategory = doc.identity.change ? 'changes' : doc.identity.type === 'srs' ? 'specs' : doc.identity.type;
      const expectedPath = doc.identity.change ? path.join(config.directories.changes, doc.identity.change, `${doc.identity.type}.md`) : null;
      if (entry.category !== expectedCategory || (expectedPath && expectedPath !== entry.absolute)) doc.add('E_LOCATION', 'Путь не соответствует ID/типу; перенесите документ в соответствующий каталог.');
      readMarkdown(doc);
    }
  }
  const index = new Map();
  const bundles = new Map(indexOnly ? [] : changeDirectories.map(change => [change, new Map()]));
  for (const doc of documents.filter(d => d.identity)) {
    const { id, change, type } = doc.identity;
    if (index.has(id)) {
      const other = index.get(id);
      doc.add('E_DUPLICATE_ID', `ID ${id} также объявлен в ${other.file}; устраните дубликат.`);
      other.add('E_DUPLICATE_ID', `ID ${id} также объявлен в ${doc.file}; устраните дубликат.`);
    } else index.set(id, doc);
    if (change) {
      if (!bundles.has(change)) bundles.set(change, new Map());
      bundles.get(change).set(type, doc);
    }
  }
  if (!indexOnly) {
    for (const [change, bundle] of bundles) {
      const first = bundle.values().next().value;
      for (const type of ['intent', 'spec', 'plan']) if (!bundle.has(type)) {
        const message = `Нет обязательного ${type}.md; восстановите комплект.`;
        if (first) first.add('E_STRUCTURE', message);
        else diagnostics.push(diagnostic(path.relative(config.root, path.join(config.directories.changes, change)), 'E_STRUCTURE', message));
      }
      if (['in_progress', 'blocked', 'completed'].includes(bundle.get('plan')?.metadata.execution) && !bundle.has('journal')) first.add('E_STRUCTURE', 'Начатая задача требует Journal; сохраните состояние реализации.');
    }
    for (const doc of documents.filter(d => d.identity)) for (const ref of doc.references) {
      const target = addressIdentity(ref.value);
      if (!target) { doc.add('E_REFERENCE_SYNTAX', `Некорректный адрес ${ref.value}; используйте полный логический ID.`, ref.offset); continue; }
      if (ref.key === 'research' && (target.type !== 'research' || target.local)
        || ref.key === 'adr' && (target.type !== 'adr' || target.local)
        || ref.key === 'supersedes' && (target.type !== doc.identity.type || target.local || target.bundle)) {
        doc.add('E_FIELD', `${ref.key}: неверный тип адресата ${ref.value}; исправьте связь.`, ref.offset);
      }
      const exists = target.bundle ? ['intent', 'spec', 'plan'].every(t => bundles.get(target.bundle)?.has(t))
        : index.has(target.document) && (!target.local || index.get(target.document).locals.has(target.local));
      if (!exists) doc.add('E_REFERENCE_TARGET', `Нет адресата ${ref.value}; восстановите цель или исправьте ссылку.`, ref.offset);
    }
  }
  return { documents, index, diagnostics: sortDiagnostics(diagnostics) };
}
