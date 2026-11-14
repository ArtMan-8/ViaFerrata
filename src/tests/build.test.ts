import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { write } from "./helpers.ts";
import { command, execute, packagingSource } from "./package-helpers.ts";

void test(
  "clean build and prepack reject type errors and never reuse stale output",
  { timeout: 120000 },
  async (t) => {
    const { temp, source } = await packagingSource(t);
    const entry = path.join(source, "bin/vf.ts");
    assert.match(command(process.execPath, [entry, "--help"], temp), /new/);
    command(process.execPath, [path.join(source, "scripts/input-manifest.ts")], temp);
    await write(source, "src/obsolete.ts", "export const obsolete = true;\n");
    command("npm", ["run", "build"], source);
    await fs.access(path.join(source, "dist/src/obsolete.js"));
    await fs.unlink(path.join(source, "src/obsolete.ts"));
    await fs.appendFile(
      path.join(source, "src/cli/main.ts"),
      '\nexport const buildMarker = "fresh source";\n',
    );
    await write(source, "dist/src/cli/main.js", 'throw new Error("stale build");\n');
    command("npm", ["pack", "--ignore-scripts=false", "--pack-destination", temp], source);
    await assert.rejects(fs.access(path.join(source, "dist/src/obsolete.js")), {
      code: "ENOENT",
    });
    assert.match(
      await fs.readFile(path.join(source, "dist/src/cli/main.js"), "utf8"),
      /fresh source/,
    );
    assert.match(
      command(process.execPath, [path.join(source, "dist/bin/vf.js"), "--help"], temp),
      /new/,
    );
    const packed = path.join(temp, "viaferrata-0.1.0.tgz");
    await fs.access(packed);
    await fs.unlink(packed);

    // Each code directory must participate in the separate strict type check.
    for (const directory of ["bin", "src", "src/tests", "scripts"]) {
      const probe = `${directory}/typecheck-probe.ts`;
      await write(source, probe, "export const invalid: string = 42;\n");
      const checked = execute("npm", ["run", "typecheck"], source);
      assert.notEqual(checked.status, 0, checked.text);
      assert.match(checked.text, /typecheck-probe\.ts.*error TS/);
      await fs.unlink(path.join(source, probe));
    }
    await write(source, "src/tests/typecheck-probe.ts", "export const invalid: string = 42;\n");
    const failedBuild = execute("npm", ["run", "build"], source);
    assert.notEqual(failedBuild.status, 0, failedBuild.text);
    await assert.rejects(fs.access(path.join(source, "dist")), {
      code: "ENOENT",
    });
    const failedPack = execute(
      "npm",
      ["pack", "--ignore-scripts=false", "--pack-destination", temp],
      source,
    );
    assert.notEqual(failedPack.status, 0, failedPack.text);
    await assert.rejects(fs.access(packed), { code: "ENOENT" });
  },
);
