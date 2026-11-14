import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../config.ts";
import { CommandError } from "../diagnostics.ts";
import { project, temporary, write, snapshot } from "../tests/helpers.ts";
import { initProject, type InitIO } from "./init.ts";
import { createChange, type ChangeIO } from "./new.ts";

const fault = (message: string) => Object.assign(new Error(message), { code: "EIO" });

for (const writeFails of [false, true]) {
  for (const closeFails of [false, true]) {
    for (const cleanupFails of [false, true]) {
      if (!writeFails && !closeFails && !cleanupFails) {
        continue;
      }
      void test(`init retains failures write=${writeFails} close=${closeFails} cleanup=${cleanupFails}`, async (t) => {
        const root = await temporary(t);
        if (writeFails || closeFails) {
          await write(root, ".gitignore", "keep\n");
        }
        const before = await snapshot(root);
        const io: InitIO = {
          ...fs,
          open: async (file, flags) => {
            const handle = await fs.open(file, flags);
            return {
              chmod: (mode) => handle.chmod(mode),
              writeFile: async (...args) => {
                if (writeFails) {
                  throw fault("WRITE_FAILURE");
                }
                await handle.writeFile(...args);
              },
              close: async () => {
                await handle.close();
                if (closeFails) {
                  throw fault("CLOSE_FAILURE");
                }
              },
            };
          },
          unlink: async (file) => {
            if (cleanupFails) {
              throw fault("CLEANUP_FAILURE");
            }
            await fs.unlink(file);
          },
        };
        await assert.rejects(initProject(root, "lite", { io }), (error) => {
          assert(error instanceof CommandError);
          assert.equal(error.code, "E_IO");
          for (const [failed, marker] of [
            [writeFails, "WRITE_FAILURE"],
            [closeFails, "CLOSE_FAILURE"],
            [cleanupFails, "CLEANUP_FAILURE"],
          ] as const) {
            assert.equal(error.message.includes(marker), failed, error.message);
          }
          if (cleanupFails) {
            assert.match(error.file, /\.vf-init-.*\.tmp$/);
          }
          return true;
        });
        const after = await snapshot(root);
        if (writeFails || closeFails) {
          assert.deepEqual(after[".gitignore"], before[".gitignore"]);
        } else {
          assert.equal(await fs.readFile(path.join(root, ".gitignore"), "utf8"), "/.viaferrata/\n");
        }
        assert.equal(
          Object.keys(after).filter((file) => file.startsWith(".vf-init-")).length,
          cleanupFails ? 1 : 0,
        );
      });
    }
    if (!writeFails && !closeFails) {
      continue;
    }
    void test(`new retains failures write=${writeFails} close=${closeFails} and partial file`, async (t) => {
      const root = await project(t, false);
      const io: ChangeIO = {
        ...fs,
        open: async (file, flags) => {
          const handle = await fs.open(file, flags);
          return {
            writeFile: async (...args) => {
              if (writeFails) {
                await handle.writeFile("partial");
                throw fault("WRITE_FAILURE");
              }
              await handle.writeFile(...args);
            },
            close: async () => {
              await handle.close();
              if (closeFails) {
                throw fault("CLOSE_FAILURE");
              }
            },
          };
        },
      };
      await assert.rejects(createChange(await loadConfig(root), "Failure", { io }), (error) => {
        assert(error instanceof CommandError);
        assert.equal(error.code, "E_IO");
        assert.equal(error.message.includes("WRITE_FAILURE"), writeFails, error.message);
        assert.equal(error.message.includes("CLOSE_FAILURE"), closeFails, error.message);
        assert.match(error.message, /intent.md/);
        return true;
      });
      assert.deepEqual(await fs.readdir(path.join(root, "viaferrata/changes/change-000001")), [
        "intent.md",
      ]);
    });
  }
}

void test("programming defects during IO retain internal classification and partial context", async (t) => {
  const root = await temporary(t);
  const defect = new TypeError("broken writer");
  await assert.rejects(
    initProject(root, "lite", {
      io: {
        ...fs,
        open: async () => {
          throw defect;
        },
      },
    }),
    (error) => {
      assert(error instanceof CommandError);
      assert.equal(error.code, "E_INTERNAL");
      assert.equal(error.cause, defect);
      assert.match(error.message, /Целевые файлы подключения не изменены/);
      return true;
    },
  );
  const projectRoot = await project(t, false);
  await assert.rejects(
    createChange(await loadConfig(projectRoot), "Defect", {
      io: {
        ...fs,
        open: async () => {
          throw defect;
        },
      },
    }),
    (error) => {
      assert(error instanceof CommandError);
      assert.equal(error.code, "E_INTERNAL");
      assert.equal(error.cause, defect);
      assert.match(error.message, /change-000001/);
      return true;
    },
  );
});
