import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { edit, project, run, write } from "../tests/helpers.ts";

void test("complete evaluates the working change, preserves rejected plans and supports retries", async (t) => {
  const root = await project(t);
  const change = "change-000042";
  const dir = "viaferrata/changes/" + change + "/";
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  await write(root, "viaferrata.toml", 'profile = "strict"\n');
  git("init", "-q");
  git("add", "viaferrata");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "before setup",
  );
  const beforeSetup = git("rev-parse", "HEAD");
  git("add", ".");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "base",
  );
  const base = git("rev-parse", "HEAD");
  for (const name of ["intent", "spec", "plan"]) {
    await edit(root, dir + name + ".md", (s) =>
      s
        .replace("status: draft", "status: approved")
        .replace("execution: not_started", "execution: 'in_progress' # preserve"),
    );
  }
  await edit(root, dir + "spec.md", (s) => s + "\n```yaml\ncompletion_checks: [test]\n```\n");
  const digest = run(["scope", change, "--digest"], root).stdout.trim();
  const policy = createHash("sha256").update('["test"]').digest("hex");
  const journal = `---
id: ${change}/journal
created: "2026-11-24"
updated: "2026-11-24"
---

# Результат

## Current State

Работа выполнена.

## Significant Events

\`\`\`yaml
decisions: [Согласовано]
scope_check:
  base: ${base}
  digest: ${digest}
completion_digest: ${policy}
\`\`\`

## Verification and Result

### Verification

\`\`\`yaml
checks:
  - subject: test
    outcome: passed
    source: CI
    revision: inputs
    verification: V-1
\`\`\`

#### V-1: Экспорт

- Verifies:
  - [${change}/intent/AC-1]
- Revision: inputs

### Result

Проверен пустой экспорт.
`;
  const cli = () => run(["complete", change], root);
  await write(root, dir + "journal.md", journal);
  assert.match(cli().stderr, /P-1/);
  await edit(root, dir + "plan.md", (s) => s.replace("- [ ] P-1", "- [x] P-1"));
  const plan = await fs.readFile(path.join(root, dir, "plan.md"), "utf8");
  for (const [before, after, reason] of [
    ["subject: test", "subject: build", /test/],
    ["outcome: passed", "outcome: blocked", /test/],
    ["outcome: passed", "outcome: failed", /test/],
    ["revision: inputs", "revision: null", /test/],
    ["- Revision: inputs", "- Revision:", /V-1/],
    ["- Verifies:", "- Evidence:", /AC-1/],
    ["    verification: V-1", "    verification: V-2", /V-2/],
    [policy, "other", /completion_digest/],
    ["decisions: [Согласовано]", "decisions: []", /decisions/],
    ["Проверен пустой экспорт.", "", /Result/],
  ] as const) {
    await write(root, dir + "journal.md", journal.replace(before, after));
    const result = cli();
    assert.notEqual(result.status, 0, result.text);
    assert.match(result.stderr, reason);
    assert.equal(await fs.readFile(path.join(root, dir, "plan.md"), "utf8"), plan);
  }
  await write(root, dir + "journal.md", journal);
  const configPath = path.join(root, "viaferrata.toml");
  const originalConfig = await fs.readFile(configPath, "utf8");
  await edit(root, dir + "spec.md", (s) =>
    s.replace("completion_checks: [test]", "completion_checks: [test, build]"),
  );
  assert.match(cli().stderr, /completion_digest/);
  await edit(root, dir + "spec.md", (s) =>
    s.replace("completion_checks: [test, build]", "completion_checks: [test]"),
  );
  await write(root, "outside", "outside scope");
  assert.match(cli().stderr, /outside/);
  await fs.unlink(path.join(root, "outside"));
  await edit(root, dir + "spec.md", (s) => s.replace("src/export.js", "*"));
  await write(
    root,
    dir + "journal.md",
    journal.replace(digest, run(["scope", change, "--digest"], root).stdout.trim()),
  );
  await edit(root, dir + "journal.md", (s) => s.replace(base, beforeSetup));
  const missingConfig = cli();
  assert.notEqual(missingConfig.status, 0);
  assert.match(missingConfig.stderr, /E_CONFIG.*базовом коммите/);
  assert.equal(await fs.readFile(path.join(root, dir, "plan.md"), "utf8"), plan);
  await edit(root, dir + "journal.md", (s) => s.replace(beforeSetup, base));
  await write(root, "viaferrata.toml", 'profile = "lite"\n');
  assert.match(cli().stderr, /профиль strict/);
  await fs.writeFile(configPath, originalConfig);
  await write(
    root,
    dir + "journal.md",
    journal.replace(digest, run(["scope", change, "--digest"], root).stdout.trim()),
  );
  // An unrelated, pre-existing draft must not veto this transition.
  await write(root, "viaferrata/changes/change-000043/intent.md", "# Неполный комплект");
  git("add", "viaferrata/changes/change-000043");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "other draft",
  );
  const updatedBase = git("rev-parse", "HEAD");
  await edit(root, dir + "journal.md", (s) => s.replace(base, updatedBase));
  await edit(root, dir + "intent.md", (s) => s.replace("srs-000007/R-1", "srs-000007/R-999"));
  assert.match(cli().stderr, /R-999/);
  await edit(root, dir + "intent.md", (s) => s.replace("srs-000007/R-999", "srs-000007/R-1"));
  const result = cli();
  assert.equal(result.status, 0, result.text);
  assert.equal(
    await fs.readFile(path.join(root, dir, "plan.md"), "utf8"),
    plan.replace("'in_progress'", "completed"),
  );
  assert.match(cli().stdout, /уже completed/);
  // Test lite against its own policy base, then enable just verification-coverage.
  await write(root, dir + "plan.md", plan);
  await write(root, "viaferrata.toml", 'profile = "lite"\n');
  git("add", "viaferrata.toml");
  git(
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "lite project",
  );
  await edit(root, dir + "journal.md", (s) =>
    s.replace(updatedBase, git("rev-parse", "HEAD")).replace("- Verifies:", "- Evidence:"),
  );
  await write(
    root,
    "viaferrata.toml",
    'profile = "lite"\nrequired_checks = ["verification-coverage"]\n',
  );
  assert.match(cli().stderr, /AC-1/);
  await write(root, "viaferrata.toml", 'profile = "lite"\n');
  const lite = cli();
  assert.equal(lite.status, 0, lite.text);
});
