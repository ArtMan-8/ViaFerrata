import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
  initProject,
  instructionFiles,
  type InitIO,
} from "../src/commands/init.ts";
import { CommandError } from "../src/diagnostics.ts";
import { temporary, write, run, snapshot } from "./helpers.ts";

const init = ["init", "--profile", "lite"];
const fault = () =>
  Object.assign(new Error("controlled IO failure"), { code: "EIO" });

function git(root: string, ...args: string[]) {
  const result = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

test("init creates exactly three files and preserves bytes and mtime on repeat", async (t) => {
  const root = await temporary(t);
  const first = run(init, root);
  assert.equal(first.status, 0, first.text);
  assert.match(first.stdout, /Подключение подготовлено/);
  assert.match(first.stdout, /Профиль: lite/);
  assert.match(first.stdout, /не подтверждает согласование/);
  assert.match(first.stdout, /tracked данные требуют отдельного решения/);
  assert.equal(first.stderr, "");
  assert.deepEqual((await fs.readdir(root)).sort(), [
    ".gitignore",
    "AGENTS.md",
    "viaferrata.toml",
  ]);
  assert.equal(
    await fs.readFile(path.join(root, "viaferrata.toml"), "utf8"),
    'profile = "lite"\n',
  );
  assert.equal(
    await fs.readFile(path.join(root, ".gitignore"), "utf8"),
    "/.viaferrata/\n",
  );
  const agents = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
  for (const text of [
    "vf с --help",
    "viaferrata.toml",
    "documents_root",
    "Intent/Spec/Plan",
    "Journal",
  ])
    assert(agents.includes(text), text);
  assert(!agents.includes(root));
  assert(!agents.includes("change-000002"));
  const before = await snapshot(root);
  const second = run(["init"], root);
  assert.equal(second.status, 0, second.text);
  assert.match(second.stdout, /AGENTS.md: сохранён/);
  assert.deepEqual(await snapshot(root), before);
  for (const file of instructionFiles) {
    assert(first.stdout.includes(file));
    assert(run(["--help"], root).stdout.includes(file));
    assert((await fs.readFile(file)).length > 0);
  }
});

test("init uses relative or absolute root, supports spaces and never searches parents", async (t) => {
  const outer = await temporary(t);
  const target = path.join(outer, "target project");
  const sibling = path.join(outer, "sibling");
  await fs.mkdir(target);
  await write(sibling, "keep.txt", "сосед\n");
  const before = await snapshot(sibling);
  assert.equal(
    run(["--root", "../target project", ...init], sibling).status,
    0,
  );
  assert.deepEqual(await snapshot(sibling), before);
  const connected = await snapshot(target);
  assert.equal(run(["--root", target, "init"], sibling).status, 0);
  assert.deepEqual(await snapshot(target), connected);
  const nested = path.join(target, "nested");
  await fs.mkdir(nested);
  const parent = await snapshot(target);
  const missingProfile = run(["init"], nested);
  assert.equal(missingProfile.status, 2, missingProfile.text);
  assert.match(missingProfile.stderr, /E_CONFIG/);
  assert.deepEqual(await snapshot(target), parent);
  assert.equal(run(init, nested).status, 0);
  assert.equal(
    await fs.readFile(path.join(target, "viaferrata.toml"), "utf8"),
    'profile = "lite"\n',
  );
});

for (const args of [
  ["init", "project"],
  ["init", "--force"],
  ["init", "--yes"],
  ["init", "--profile"],
  ["init", "--profile", "unknown"],
  ["init", "--profile", "lite", "--profile", "lite"],
  ["init", "--root", "."],
  ["--profile", "lite", "init"],
  ["--root", ".", "--root", ".", ...init],
  ["init", "--documents-root", "docs"],
])
  test(`init rejects arguments ${args.join(" ")}`, async (t) => {
    const root = await temporary(t);
    const result = run(args, root);
    assert.equal(result.status, 2, result.text);
    assert.match(result.stderr, /E_USAGE/);
    assert.equal(result.stdout, "");
    assert.deepEqual(await fs.readdir(root), []);
  });

test("init preserves strict config, custom document root and existing project data", async (t) => {
  const root = await temporary(t);
  const config =
    '# выбор проекта\r\nprofile = "strict"\r\ndocuments_root = "process docs"\r\nrequired_checks = []\r\nprotected_paths = []\r\n';
  await write(root, "viaferrata.toml", config);
  await write(root, "README.md", "Описание пользователя\n");
  // An unfinished document must not be inspected by init.
  await write(root, "process docs/changes/notes.txt", "Ручной документ\n");
  const before = await snapshot(root);
  const result = run(["init", "--profile", "strict"], root);
  assert.equal(result.status, 0, result.text);
  assert.match(result.stdout, /Профиль: strict/);
  for (const [file, state] of Object.entries(before))
    assert.deepEqual((await snapshot(root))[file], state);
  const created = run(["new", "После подключения"], root);
  assert.equal(created.status, 0, created.text);
  await fs.access(
    path.join(root, "process docs/changes/change-000001/intent.md"),
  );
  assert.equal(
    await fs.stat(path.join(root, "viaferrata")).catch(() => null),
    null,
  );
});

for (const [body, code, args] of [
  ['profile = "strict"\n', "E_CONFIG", init],
  ['profile = "wrong"\n', "E_CONFIG", ["init"]],
  ['documents_root = "docs"\n', "E_CONFIG", ["init"]],
  ["profile = [\n", "E_CONFIG", ["init"]],
  ['profile = "lite"\nprofile = "strict"\n', "E_CONFIG", ["init"]],
  ['profile = "lite"\nunknown = true\n', "E_CONFIG", ["init"]],
  [
    'profile = "lite"\nrequired_checks = ["npm test"]\n',
    "E_UNSUPPORTED",
    ["init"],
  ],
  [
    'profile = "lite"\nprotected_paths = ["src/**"]\n',
    "E_UNSUPPORTED",
    ["init"],
  ],
  ['profile = "lite"\ndocuments_root = "../outside"\n', "E_CONFIG", ["init"]],
  ['profile = "lite"\ndocuments_root = "  "\n', "E_CONFIG", ["init"]],
] as const)
  test(`init preflight: ${body.trim().replaceAll("\n", "; ")}`, async (t) => {
    const root = await temporary(t);
    await write(root, "viaferrata.toml", body);
    await write(root, "AGENTS.md", "ручные правила\n");
    const before = await snapshot(root);
    const result = run([...args], root);
    assert.equal(result.status, 2, result.text);
    assert(result.stderr.includes(code), result.text);
    assert(!result.stdout.includes("Подключение подготовлено"));
    assert.deepEqual(await snapshot(root), before);
  });

for (const eol of ["\n", "\r\n"])
  test(`init preserves BOM, manual content and line endings ${JSON.stringify(eol)}`, async (t) => {
    const root = await temporary(t);
    const agentPrefix = `\uFEFF# Правила${eol}Авторский текст без финального LF`;
    const ignorePrefix = `\uFEFF# Исключения${eol}node_modules/`;
    await write(root, "AGENTS.md", agentPrefix);
    await write(root, ".gitignore", ignorePrefix);
    await write(root, "README.md", "README\n");
    const readme = (await snapshot(root))["README.md"];
    assert.equal(run(init, root).status, 0);
    const agentsFile = path.join(root, "AGENTS.md");
    const agents = await fs.readFile(agentsFile, "utf8");
    assert(agents.startsWith(agentPrefix + eol));
    assert.equal(
      await fs.readFile(path.join(root, ".gitignore"), "utf8"),
      ignorePrefix + eol + "/.viaferrata/" + eol,
    );
    await fs.appendFile(
      agentsFile,
      `${eol}Дополнительные правила после блока${eol}`,
    );
    const before = await snapshot(root);
    assert.equal(run(["init"], root).status, 0);
    assert.deepEqual(await snapshot(root), before);
    assert.deepEqual(before["README.md"], readme);
  });

for (const change of [
  (s: string) => s.replace("Прочитай", "Изменено вручную"),
  (s: string) => s.replace("<!-- viaferrata:end -->", ""),
  (s: string) => s + s,
  (s: string) =>
    s.replace("<!-- viaferrata:begin -->", "prefix<!-- viaferrata:begin -->"),
  (s: string) =>
    s.replace("<!-- viaferrata:begin -->", "<!-- viaferrata:end -->"),
])
  test(`init refuses edited or malformed AGENTS block (${change.toString()})`, async (t) => {
    const root = await temporary(t);
    await initProject(root, "lite");
    const file = path.join(root, "AGENTS.md");
    await fs.writeFile(file, change(await fs.readFile(file, "utf8")));
    await fs.unlink(path.join(root, ".gitignore"));
    const before = await snapshot(root);
    const result = run(["init"], root);
    assert.equal(result.status, 2, result.text);
    assert.match(result.stderr, /AGENTS.md:1:1 E_EXISTS/);
    assert.deepEqual(await snapshot(root), before);
  });

for (const [original, expected] of [
  ["/.viaferrata/\nnode_modules/\n", "same"],
  [".viaferrata/\r\n# !comment\r\n", "same"],
  ["\uFEFF/.viaferrata/", "same"],
  ["!/.viaferrata/\n", "append"],
  ["/.viaferrata/\n!other\n", "conflict"],
  ["/.viaferrata/\n!/.viaferrata/\n", "conflict"],
  ["/.viaferrata/\n!other\n/.viaferrata/\n", "same"],
])
  test(`init gitignore policy: ${JSON.stringify(original)}`, async (t) => {
    const root = await temporary(t);
    await write(root, ".gitignore", original);
    const before = await snapshot(root);
    const result = run(init, root);
    if (expected === "conflict") {
      assert.equal(result.status, 2, result.text);
      assert.match(result.stderr, /E_EXISTS/);
      assert.deepEqual(await snapshot(root), before);
    } else {
      assert.equal(result.status, 0, result.text);
      if (expected === "same")
        assert.deepEqual(
          (await snapshot(root))[".gitignore"],
          before[".gitignore"],
        );
      else
        assert.equal(
          await fs.readFile(path.join(root, ".gitignore"), "utf8"),
          original + "/.viaferrata/\n",
        );
      const connected = await snapshot(root);
      assert.equal(run(["init"], root).status, 0);
      assert.deepEqual(await snapshot(root), connected);
    }
  });

test("init excludes temporary data in real Git and preserves the index and tracked data", async (t) => {
  const root = await temporary(t);
  assert.equal(git(root, "init", "--quiet").status, 0);
  await write(root, ".viaferrata/tracked.txt", "уже отслеживается\n");
  await write(root, "viaferrata/changes/manual.md", "документ\n");
  assert.equal(git(root, "add", ".viaferrata/tracked.txt").status, 0);
  const index = await fs.readFile(path.join(root, ".git/index"));
  const result = run(init, root);
  assert.equal(result.status, 0, result.text);
  assert.deepEqual(await fs.readFile(path.join(root, ".git/index")), index);
  assert.equal(
    git(root, "check-ignore", "--quiet", ".viaferrata/cache").status,
    0,
  );
  assert.equal(
    git(root, "check-ignore", "--quiet", "viaferrata/changes/manual.md").status,
    1,
  );
  assert.equal(
    await fs.readFile(path.join(root, ".viaferrata/tracked.txt"), "utf8"),
    "уже отслеживается\n",
  );
});

for (const documentsRoot of [
  "AGENTS.md",
  ".gitignore/nested",
  "viaferrata.toml",
  "process/docs",
]) {
  test(`init rejects document path collision ${documentsRoot}`, async (t) => {
    const root = await temporary(t);
    await write(
      root,
      "viaferrata.toml",
      `profile = "lite"\ndocuments_root = "${documentsRoot}"\n`,
    );
    if (documentsRoot === "process/docs") await write(root, "process", "file");
    const before = await snapshot(root);
    const result = run(["init"], root);
    assert.equal(result.status, 2, result.text);
    assert.match(result.stderr, /E_CONFIG/);
    assert.deepEqual(await snapshot(root), before);
  });
}

for (const name of [
  "AGENTS.md",
  ".gitignore",
  "viaferrata.toml",
  "viaferrata",
  "viaferrata/changes",
]) {
  test(`init rejects symlink ${name} without changing its target`, async (t) => {
    const root = await temporary(t);
    const outside = await temporary(t);
    await write(outside, "sentinel.txt", "keep\n");
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.symlink(outside, path.join(root, name));
    const before = await snapshot(root);
    const external = await snapshot(outside);
    const result = run(init, root);
    assert.equal(result.status, 2, result.text);
    assert.match(result.stderr, /E_UNSUPPORTED/);
    assert.deepEqual(await snapshot(root), before);
    assert.deepEqual(await snapshot(outside), external);
    assert((await fs.lstat(path.join(root, name))).isSymbolicLink());
  });
}

test("init rejects missing, file or symlink project roots", async (t) => {
  const root = await temporary(t);
  await write(root, "file", "keep");
  await fs.symlink(root, path.join(root, "link"));
  for (const [name, code] of [
    ["missing", "E_CONFIG"],
    ["file", "E_CONFIG"],
    ["file/nested", "E_CONFIG"],
    ["link", "E_UNSUPPORTED"],
  ]) {
    const result = run(["--root", path.join(root, name), ...init], root);
    assert.equal(result.status, 2, result.text);
    assert(result.stderr.includes(code), result.text);
    assert.match(result.stderr, /^\S+:1:1 /);
  }
  assert.deepEqual((await fs.readdir(root)).sort(), ["file", "link"]);
});

for (const name of ["AGENTS.md", ".gitignore", "viaferrata.toml"])
  test(`init rejects directory in place of ${name}`, async (t) => {
    const root = await temporary(t);
    await fs.mkdir(path.join(root, name));
    const result = run(init, root);
    assert.equal(result.status, 2, result.text);
    assert.match(result.stderr, /E_EXISTS/);
    assert.deepEqual(await fs.readdir(root), [name]);
  });

for (const name of ["AGENTS.md", ".gitignore"])
  test(`init refuses non-UTF-8 ${name}`, async (t) => {
    const root = await temporary(t);
    await write(root, name, Buffer.from([0xff, 0xfe, 0x00, 0x41]));
    const before = await snapshot(root);
    const result = run(init, root);
    assert.equal(result.status, 2, result.text);
    assert.match(result.stderr, /E_UNSUPPORTED/);
    assert.deepEqual(await snapshot(root), before);
  });

test("missing package resource and unreadable target fail before any write", async (t) => {
  const root = await temporary(t);
  await assert.rejects(
    initProject(root, "lite", {
      instructions: [path.join(root, "missing-rule")],
    }),
    { code: "E_IO" },
  );
  assert.deepEqual(await fs.readdir(root), []);
  await write(root, "AGENTS.md", "keep");
  const before = await snapshot(root);
  const io: InitIO = {
    ...fs,
    readFile: async (file) => {
      if (file.endsWith("AGENTS.md")) throw fault();
      return fs.readFile(file);
    },
  };
  await assert.rejects(initProject(root, "lite", { io }), { code: "E_IO" });
  assert.deepEqual(await snapshot(root), before);
});

for (const failAt of [1, 2, 3])
  test(`init resumes after write failure at file ${failAt}`, async (t) => {
    const root = await temporary(t);
    let count = 0;
    const io: InitIO = {
      ...fs,
      open: async (file, flags) => {
        const handle = await fs.open(file, flags);
        return {
          chmod: (mode) => handle.chmod(mode),
          close: () => handle.close(),
          writeFile: async (...args) => {
            if (++count === failAt) {
              await handle.writeFile("partial temporary bytes");
              throw fault();
            }
            return handle.writeFile(...args);
          },
        };
      },
    };
    await assert.rejects(initProject(root, "lite", { io }), (error) => {
      assert(error instanceof CommandError);
      assert.equal(error.code, "E_IO");
      assert(
        error.message.includes(
          failAt === 1 ? "Выполненные изменения: нет" : ".gitignore",
        ),
      );
      if (failAt === 3) assert(error.message.includes("AGENTS.md"));
      return true;
    });
    const remaining = await snapshot(root);
    assert.equal(Object.keys(remaining).length, failAt - 1);
    assert(
      !(await fs.readdir(root)).some((name) => name.startsWith(".vf-init-")),
    );
    await initProject(root, "lite");
    for (const [name, value] of Object.entries(remaining))
      assert.deepEqual((await snapshot(root))[name], value);
    const complete = await snapshot(root);
    await initProject(root);
    assert.deepEqual(await snapshot(root), complete);
  });

for (const operation of ["write", "rename"])
  test(`init never truncates existing files on ${operation} failure`, async (t) => {
    const root = await temporary(t);
    await write(root, ".gitignore", "node_modules/\n");
    await write(root, "AGENTS.md", "Правила пользователя\n");
    await fs.chmod(path.join(root, ".gitignore"), 0o640);
    const before = await snapshot(root);
    const io: InitIO = {
      ...fs,
      rename: async (from, to) => {
        if (operation === "rename") throw fault();
        return fs.rename(from, to);
      },
      open: async (file, flags) => {
        const handle = await fs.open(file, flags);
        return {
          chmod: (mode) => handle.chmod(mode),
          close: () => handle.close(),
          writeFile: async (...args) => {
            if (operation === "write") {
              await handle.writeFile("partial");
              throw fault();
            }
            return handle.writeFile(...args);
          },
        };
      },
    };
    await assert.rejects(initProject(root, "lite", { io }), { code: "E_IO" });
    assert.deepEqual(await snapshot(root), before);
    await initProject(root, "lite");
    assert.equal(
      (await fs.stat(path.join(root, ".gitignore"))).mode & 0o777,
      0o640,
    );
  });

test("init detects a concurrent edit before replacement and keeps external content", async (t) => {
  const root = await temporary(t);
  await write(root, ".gitignore", "node_modules/\n");
  let changed = false;
  const io: InitIO = {
    ...fs,
    open: async (file, flags) => {
      if (!changed) {
        changed = true;
        await write(root, ".gitignore", "внешнее изменение\n");
      }
      return fs.open(file, flags);
    },
  };
  await assert.rejects(initProject(root, "lite", { io }), { code: "E_EXISTS" });
  assert.equal(
    await fs.readFile(path.join(root, ".gitignore"), "utf8"),
    "внешнее изменение\n",
  );
  assert.deepEqual(await fs.readdir(root), [".gitignore"]);
});

test("exclusive publication does not overwrite a newly occupied target", async (t) => {
  const root = await temporary(t);
  const io: InitIO = {
    ...fs,
    link: async (from, to) => {
      await fs.writeFile(to, "занято другим действием\n", { flag: "wx" });
      return fs.link(from, to);
    },
  };
  await assert.rejects(initProject(root, "lite", { io }), { code: "E_EXISTS" });
  assert.equal(
    await fs.readFile(path.join(root, ".gitignore"), "utf8"),
    "занято другим действием\n",
  );
  assert.deepEqual(await fs.readdir(root), [".gitignore"]);
});
