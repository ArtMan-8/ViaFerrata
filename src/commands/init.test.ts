import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { CommandError } from "../diagnostics.ts";
import { instructionFiles } from "../resources.ts";
import { temporary, write, run, snapshot } from "../tests/helpers.ts";
import { initProject, type InitIO } from "./init.ts";

const fault = () => Object.assign(new Error("controlled IO failure"), { code: "EIO" });

void test("init preserves a formatted AGENTS block and the legacy layout", async (t) => {
  const root = await temporary(t);
  await initProject(root, "lite");
  const file = path.join(root, "AGENTS.md");
  const original = await fs.readFile(file, "utf8");
  const legacy = original.replace("<!-- viaferrata:begin -->\n\n", "<!-- viaferrata:begin -->\n");
  const formatted = legacy.replace("<!-- viaferrata:begin -->\n", "<!-- viaferrata:begin -->\n\n");
  for (const block of [formatted, legacy, `\uFEFF${formatted.replaceAll("\n", "\r\n")}`]) {
    await fs.writeFile(file, block);
    const before = await snapshot(root);
    await initProject(root);
    assert.deepEqual(await snapshot(root), before);
  }
});

for (const change of [
  (s: string) => s.replace("Прочитай", "Изменено вручную"),
  (s: string) => s.replace("<!-- viaferrata:end -->", ""),
  (s: string) => s + s,
  (s: string) => s.replace("<!-- viaferrata:begin -->", "prefix<!-- viaferrata:begin -->"),
  (s: string) => s.replace("<!-- viaferrata:begin -->", "<!-- viaferrata:end -->"),
]) {
  void test(`init refuses edited or malformed AGENTS block (${change.toString()})`, async (t) => {
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
}

void test("missing package resource and unreadable target fail before any write", async (t) => {
  const root = await temporary(t);
  await assert.rejects(
    initProject(root, "lite", {
      instructions: {
        ...instructionFiles,
        workflow: path.join(root, "missing-rule"),
      },
    }),
    { code: "E_IO" },
  );
  assert.deepEqual(await fs.readdir(root), []);
  await write(root, "AGENTS.md", "keep");
  const before = await snapshot(root);
  const io: InitIO = {
    ...fs,
    readFile: async (file) => {
      if (file.endsWith("AGENTS.md")) {
        throw fault();
      }
      return fs.readFile(file);
    },
  };
  await assert.rejects(initProject(root, "lite", { io }), { code: "E_IO" });
  assert.deepEqual(await snapshot(root), before);
});

for (const failAt of [1, 2, 3]) {
  void test(`init resumes after write failure at file ${failAt}`, async (t) => {
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
      assert(error.message.includes(failAt === 1 ? "Выполненные изменения: нет" : ".gitignore"));
      if (failAt === 3) {
        assert(error.message.includes("AGENTS.md"));
      }
      return true;
    });
    const remaining = await snapshot(root);
    assert.equal(Object.keys(remaining).length, failAt - 1);
    assert(!(await fs.readdir(root)).some((name) => name.startsWith(".vf-init-")));
    await initProject(root, "lite");
    for (const [name, value] of Object.entries(remaining)) {
      assert.deepEqual((await snapshot(root))[name], value);
    }
    const complete = await snapshot(root);
    await initProject(root);
    assert.deepEqual(await snapshot(root), complete);
  });
}

for (const operation of ["write", "rename"]) {
  void test(`init never truncates existing files on ${operation} failure`, async (t) => {
    const root = await temporary(t);
    await write(root, ".gitignore", "node_modules/\n");
    await write(root, "AGENTS.md", "Правила пользователя\n");
    await fs.chmod(path.join(root, ".gitignore"), 0o640);
    const before = await snapshot(root);
    const io: InitIO = {
      ...fs,
      rename: async (from, to) => {
        if (operation === "rename") {
          throw fault();
        }
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
    assert.equal((await fs.stat(path.join(root, ".gitignore"))).mode & 0o777, 0o640);
  });
}

void test("init detects a concurrent edit before replacement and keeps external content", async (t) => {
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
  assert.equal(await fs.readFile(path.join(root, ".gitignore"), "utf8"), "внешнее изменение\n");
  assert.deepEqual(await fs.readdir(root), [".gitignore"]);
});

void test("exclusive publication does not overwrite a newly occupied target", async (t) => {
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

for (const operation of ["close", "unlink"] as const) {
  void test(`init reports a failed ${operation} and preserves the actual remainder`, async (t) => {
    const root = await temporary(t);
    await write(root, ".gitignore", "keep\n");
    const before = await snapshot(root);
    const io: InitIO = {
      ...fs,
      open: async (file, flags) => {
        const handle = await fs.open(file, flags);
        return {
          chmod: (mode) => handle.chmod(mode),
          writeFile: async () => {
            throw fault();
          },
          close: async () => {
            await handle.close();
            if (operation === "close") {
              throw fault();
            }
          },
        };
      },
      unlink: async (file) => {
        if (operation === "unlink") {
          throw fault();
        }
        await fs.unlink(file);
      },
    };
    await assert.rejects(initProject(root, "lite", { io }), (error) => {
      assert(error instanceof CommandError);
      assert.equal(error.code, "E_IO");
      if (operation === "unlink") {
        assert.match(error.file, /\.vf-init-.*\.tmp$/);
        assert.match(error.message, /временный файл/);
      }
      return true;
    });
    const remaining = await snapshot(root);
    assert.deepEqual(remaining[".gitignore"], before[".gitignore"]);
    const temporaryFiles = Object.keys(remaining).filter((name) => name.startsWith(".vf-init-"));
    assert.equal(temporaryFiles.length, operation === "unlink" ? 1 : 0);
  });
}
