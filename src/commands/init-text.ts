import { CommandError, errorCode } from "../diagnostics.ts";

const begin = "<!-- viaferrata:begin -->";
const end = "<!-- viaferrata:end -->";

const agentBlock = `${begin}

## ViaFerrata

Прочитай локальные правила проекта. Запусти используемый vf с --help и открой
указанные инструкции и руководство форм из установленного пакета.
Если vf отсутствует в PATH, используй путь к установленному bin.
Прочитай viaferrata.toml; текущий комплект находится в <documents_root>/changes/,
где documents_root по умолчанию — viaferrata. Выбери комплект по текущей задаче.
До Implement согласуй Intent/Spec/Plan; с началом Implement веди Journal.
Validate подтверждает только заявленную структуру, не согласование и завершение.
${end}
`;

export function decode(bytes: Buffer, file: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (error) {
    if (errorCode(error) !== "ERR_ENCODING_INVALID_ENCODED_DATA") {
      throw error;
    }

    throw new CommandError(
      "E_UNSUPPORTED",
      "Требуется UTF-8; преобразуйте кодировку без потери текста.",
      file,
    );
  }
}

function append(original: string, addition: string): string {
  const eol = original.match(/\r?\n/)?.[0] ?? "\n";
  const separator = original && !original.endsWith("\n") ? eol : "";
  return original + separator + addition.replaceAll("\n", eol);
}

export function agentsText(original: string, file: string): string {
  // Count literal markers as well as full lines: broken marker placement is a conflict.
  const starts = original.split(begin).length - 1;
  const ends = original.split(end).length - 1;
  if (!starts && !ends) {
    return append(original, agentBlock);
  }

  const normalized = original.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
  const start = normalized.indexOf(begin);
  const finish = normalized.indexOf(end) + end.length;
  const expected = agentBlock.trimEnd();
  const actual = normalized.slice(start, finish);
  const legacy = expected.replace(`${begin}\n\n`, `${begin}\n`);
  if (
    starts === 1 &&
    ends === 1 &&
    (start === 0 || normalized[start - 1] === "\n") &&
    (finish === normalized.length || normalized[finish] === "\n") &&
    (actual === expected || actual === legacy)
  ) {
    return original;
  }

  throw new CommandError(
    "E_EXISTS",
    "Блок ViaFerrata изменён или повреждён; проверьте различие, вынесите дополнения за его границы либо согласуйте восстановление блока.",
    file,
  );
}

export function ignoreText(original: string, file: string): string {
  const lines = original.replace(/^\uFEFF/, "").split(/\r?\n/);
  const lastRule = lines.findLastIndex(
    (line) => line === "/.viaferrata/" || line === ".viaferrata/",
  );

  if (lastRule < 0) {
    return append(original, "/.viaferrata/\n");
  }

  if (lines.slice(lastRule + 1).some((line) => line.startsWith("!"))) {
    throw new CommandError(
      "E_EXISTS",
      "После исключения .viaferrata/ есть отрицание; проверьте правила и разместите исключение после отрицаний. Полный синтаксис gitignore не интерпретируется.",
      file,
    );
  }

  return original;
}
