import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { compareVersions, MIN_NODE_VERSION } from "../bin/version.mjs";

const current = process.versions.node;
const supported = compareVersions(current, MIN_NODE_VERSION) >= 0;

test(
  "AC-4: unsupported Node.js fails with a clear message",
  { skip: supported ? `Node.js ${current} is supported` : false },
  () => {
    const binPath = fileURLToPath(new URL("../bin/vf.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [binPath, "--version"], {
      encoding: "utf8",
    });

    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr.trimEnd().split("\n").length, 1);
    assert.match(
      result.stderr,
      new RegExp(
        `requires Node\\.js >= ${MIN_NODE_VERSION.replaceAll(".", "\\.")}`,
      ),
    );
    assert.match(result.stderr, new RegExp(current.replaceAll(".", "\\.")));
    assert.doesNotMatch(result.stderr, /ERR_UNKNOWN_FILE_EXTENSION/);
  },
);
