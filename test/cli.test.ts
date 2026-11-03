import { doesNotMatch, equal, match } from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const rootDirectory = fileURLToPath(new URL("..", import.meta.url));
const binPath = fileURLToPath(new URL("../bin/vf.mjs", import.meta.url));
const packageVersion = (
  JSON.parse(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string }
).version;

function run(args: string[]) {
  return spawnSync(process.execPath, [binPath, ...args], {
    cwd: rootDirectory,
    encoding: "utf8",
  });
}

function nonEmptyLines(value: string): string[] {
  return value.split("\n").filter((line) => line.length > 0);
}

test("AC-3: --version prints the package version and exits with 0", () => {
  const result = run(["--version"]);

  equal(result.status, 0, result.stderr);
  equal(result.stdout, `viaferrata ${packageVersion}\n`);
  equal(result.stderr, "");
});

test("AC-3: no command prints one help line to stderr and exits with 2", () => {
  const result = run([]);

  equal(result.status, 2);
  equal(result.stdout, "");
  equal(nonEmptyLines(result.stderr).length, 1);
  match(result.stderr, /no command given/);
  match(result.stderr, /try "vf --version"/);
  doesNotMatch(result.stderr, /\n\s+at /);
});

test("AC-3: unknown option prints one help line to stderr and exits with 2", () => {
  const result = run(["--unknown"]);

  equal(result.status, 2);
  equal(result.stdout, "");
  equal(nonEmptyLines(result.stderr).length, 1);
  match(result.stderr, /unknown option "--unknown"/);
  match(result.stderr, /try "vf --version"/);
  doesNotMatch(result.stderr, /\n\s+at /);
});
