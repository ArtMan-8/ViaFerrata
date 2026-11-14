import assert from "node:assert/strict";
import test from "node:test";

import { main } from "./main.ts";

void test("unexpected defects produce E_INTERNAL and their stack in stderr", async () => {
  const stderr: string[] = [];
  const failure = new TypeError("unexpected renderer defect");
  const code = await main(["--help"], {
    log: () => {
      throw failure;
    },
    error: (message: string) => {
      stderr.push(message);
    },
  });
  assert.equal(code, 2);
  assert.match(stderr.join("\n"), /E_INTERNAL/);
  assert(stderr.includes(failure.stack ?? failure.message));
});

void test("expected usage errors remain concise", async () => {
  const stderr: string[] = [];
  const code = await main(["--root", ".", "validate"], {
    log: () => {},
    error: (message: string) => {
      stderr.push(message);
    },
  });
  assert.equal(code, 2);
  assert.equal(stderr.length, 1);
  assert.match(stderr[0], /E_USAGE/);
  assert.doesNotMatch(stderr[0], /E_INTERNAL|\n\s+at /);
});
