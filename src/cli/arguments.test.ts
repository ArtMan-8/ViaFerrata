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
    assert.deepEqual(argumentsFor(args), { command: "init", path: "project", profile: "lite" });
  }
  assert.deepEqual(argumentsFor(["new", "Название"]), { command: "new", title: "Название" });
  assert.deepEqual(argumentsFor(["validate"]), { command: "validate" });
});

void test("parser rejects repeated, unknown, misplaced and invalid options and positionals", () => {
  for (const args of [
    ["--help", "--help"],
    ["--version", "--version"],
    ["init", "--profile=lite", "--profile", "lite"],
    ["--profile=lite", "validate"],
    ["--profile=strict", "new", "title"],
    ["--root", ".", "validate"],
    ["init", "--profile"],
    ["init", "--profile=other"],
    ["init", "one", "two"],
    ["new", ""],
    ["new", "a\nb"],
    ["title", "new"],
    ["validate", "extra"],
    ["--help", "--version"],
  ]) {
    assert.throws(
      () => argumentsFor(args),
      (error) => error instanceof CommandError && error.code === "E_USAGE",
      args.join(" "),
    );
  }
});
