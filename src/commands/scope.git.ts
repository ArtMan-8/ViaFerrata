import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { CommandError, errorMessage } from "../diagnostics.ts";

const execute = promisify(execFile);

async function git(root: string, args: string[]) {
  try {
    const { stdout, stderr } = await execute("git", ["--no-optional-locks", ...args], {
      cwd: root,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });

    // Git can skip unreadable untracked directories with a warning and exit 0.
    if (stderr.length) {
      throw new Error(stderr.toString("utf8").trim());
    }

    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stdout);
  } catch (error) {
    throw new CommandError(
      "E_IO",
      `Не удалось проверить Git. Проверьте репозиторий и базу. ${errorMessage(error)}`,
      root,
    );
  }
}

function records(raw: string) {
  if (!raw) {
    return [];
  }

  if (!raw.endsWith("\0")) {
    throw new CommandError("E_IO", "Неполный вывод Git. Повторите проверку.", "git");
  }

  return raw.slice(0, -1).split("\0");
}

export async function changedPaths(root: string, base: string, allowed: (name: string) => boolean) {
  if ((await git(root, ["rev-parse", "--show-toplevel"])).replace(/\r?\n$/, "") !== root) {
    throw new CommandError(
      "E_LOCATION",
      "Запустите проверку для проекта в корне рабочего дерева Git.",
      root,
    );
  }

  const head = (await git(root, ["rev-parse", "--verify", "HEAD"])).trim();
  if (
    base.length !== head.length ||
    (await git(root, ["cat-file", "-t", base])).trim() !== "commit"
  ) {
    throw new CommandError("E_FIELD", "Укажите полный SHA исходного коммита.", "scope_check.base");
  }

  await git(root, ["merge-base", "--is-ancestor", base, head]);

  const index = records(await git(root, ["ls-files", "-v", "-z"]));
  const hidden = index.find((entry) => /^[a-zS] /.test(entry));
  if (hidden) {
    throw new CommandError(
      "E_UNSUPPORTED",
      `Проверьте флаги skip-worktree и assume-unchanged у ${JSON.stringify(hidden.slice(2))} и повторите проверку.`,
      root,
    );
  }

  const problems: string[] = [];
  let checked = 0;
  function check(layer: string, name: string, unsupported: boolean) {
    checked++;
    if (unsupported || !allowed(name)) {
      problems.push(
        `${layer}: ${JSON.stringify(name)} — ${unsupported ? "неподдерживаемый объект или конфликт; разберите его отдельно" : "путь вне scope; сверьте изменение и согласуйте дельту перед продолжением"}.`,
      );
    }
  }

  for (const [layer, args] of [
    ["base → HEAD", [base, head]],
    ["staged", ["--cached", head]],
    ["unstaged", []],
  ] as const) {
    // With rename detection disabled, Git emits both endpoints as delete/add.
    const rows = records(
      await git(root, [
        "diff",
        "--raw",
        "-z",
        "--no-ext-diff",
        "--no-renames",
        "--ignore-submodules=none",
        ...args,
        "--",
      ]),
    );
    for (let i = 0; i < rows.length; i += 2) {
      const header = /^:(\d{6}) (\d{6}) [a-f0-9]+ [a-f0-9]+ ([ADMTU])$/.exec(rows[i]);
      const name = rows[i + 1];
      if (!header || !name) {
        throw new CommandError("E_IO", "Неизвестный формат diff. Проверьте состояние Git.", root);
      }
      const ordinary = (mode: string) => ["000000", "100644", "100755"].includes(mode);
      check(layer, name, header[3] === "U" || !ordinary(header[1]) || !ordinary(header[2]));
    }
  }

  for (const name of records(
    await git(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  )) {
    try {
      const stat = await fs.lstat(path.join(root, name));
      check("untracked", name, !stat.isFile());
    } catch (error) {
      throw new CommandError(
        "E_IO",
        `Не удалось проверить untracked-путь ${JSON.stringify(name)}. Повторите проверку. ${errorMessage(error)}`,
        root,
      );
    }
  }

  if (problems.length) {
    throw new CommandError("E_SCOPE", problems.join("\n"), root);
  }

  return `Scope проверен. База ${base}. Слои: base → HEAD, staged, unstaged, untracked. Записей путей: ${checked}.`;
}
