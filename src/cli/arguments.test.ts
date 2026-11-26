import assert from "node:assert/strict";
import test from "node:test";

import { CommandError } from "../diagnostics.ts";
import { argumentsFor } from "./arguments.ts";

void test("parser accepts init options in any position and both value forms", () => {
  for (const args of [
    ["init", "project", "--profile", "lite"],
    ["--profile=lite", "init", "project"],
    ["init", "--profile", "lite", "project"],
  ]) {
    assert.deepEqual(argumentsFor(args), {
      command: "init",
      path: "project",
      profile: "lite",
      documentsRoot: undefined,
    });
  }
  assert.deepEqual(argumentsFor(["new", "change", "Название"]), {
    command: "new",
    type: "change",
    title: "Название",
  });
  assert.deepEqual(argumentsFor(["validate"]), { command: "validate" });
});

void test("parser rejects repeated, unknown, misplaced and invalid options and positionals", () => {
  for (const args of [
    ["--help", "--help"],
    ["--version", "--version"],
    ["--help", "--version"],
    ["--version", "extra"],
    ["inut"],
    ["--oops"],
    ["title", "new"],
    ["--root", ".", "validate"],
    ["--profile", "init", "unknown"],
    ["constructor"],
  ]) {
    assert.throws(
      () => argumentsFor(args),
      { code: "E_CLI_SYNTAX", message: /vf --help/ },
      args.join(" "),
    );
  }
  for (const [args, hint] of [
    [["init", "--profile=lite", "--profile", "lite"], "vf init"],
    [["init", "--profle", "lite"], "vf init"],
    [["--profile=lite", "init", "--oops"], "vf init"],
    [["--profile=lite", "validate"], "vf validate"],
    [["--profile=strict", "new", "change", "title"], 'vf new change "Название"'],
    [["init", "--profile"], "vf init"],
    [["init", "--profile=other"], "vf init"],
    [["init", "one", "two"], "vf init"],
    [["new", "change", ""], 'vf new change "Название"'],
    [["new", "change", "a\nb"], 'vf new change "Название"'],
    [["new", "srs"], 'vf new srs "Название"'],
    [["new", "other"], 'vf new research "Название"'],
    [["validate", "extra"], "vf validate"],
    [["summary"], "vf summary --stdin"],
    [["scope"], "vf scope change-NNNNNN"],
    [["complete", "bad"], "vf complete change-NNNNNN"],
  ] as [string[], string][]) {
    assert.throws(
      () => argumentsFor(args),
      (error) =>
        error instanceof CommandError &&
        error.code === "E_CLI_COMMAND_USAGE" &&
        error.message.includes(hint),
      args.join(" "),
    );
  }
});
