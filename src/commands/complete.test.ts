import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../config.ts";
import { edit, project, run, write } from "../tests/helpers.ts";
import { completeChange } from "./complete.ts";

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
  assert.match(cli().stderr, /E_COMPLETION_BLOCKED:.*P-1/);
  await edit(root, dir + "plan.md", (s) => s.replace("- [ ] P-1", "- [x] P-1"));
  const plan = await fs.readFile(path.join(root, dir, "plan.md"), "utf8");
  for (const [before, after, reason] of [
    ["subject: test", "subject: build", /E_COMPLETION_BLOCKED:.*test/],
    ["outcome: passed", "outcome: blocked", /test/],
    ["outcome: passed", "outcome: failed", /test/],
    ["revision: inputs", "revision: null", /test/],
    ["- Revision: inputs", "- Revision:", /V-1/],
    ["- Verifies:", "- Evidence:", /AC-1/],
    ["    verification: V-1", "    verification: V-2", /E_FIELD:.*V-2/],
    [policy, "other", /E_FIELD:.*completion_digest/],
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
  await edit(root, dir + "spec.md", (s) =>
    s.replace("completion_checks: [test]", "completion_checks: ["),
  );
  assert.match(cli().stderr, /E_YAML:.*Некорректный YAML/);
  await edit(root, dir + "spec.md", (s) =>
    s.replace("completion_checks: [\n", "completion_checks: [test]\n"),
  );

  const duplicate = journal.replace("#### V-1:", "```yaml\nchecks: []\n```\n\n#### V-1:");
  await write(root, dir + "journal.md", duplicate);
  const location = (stderr: string) =>
    stderr
      .split("\n")
      .find((line) => line.includes("Несколько блоков checks"))
      ?.split(" E_FIELD:")[0];
  const expected =
    dir +
    "journal.md:" +
    duplicate.slice(0, duplicate.indexOf("```yaml\nchecks: []")).split("\n").length +
    ":1";
  assert.equal(location(cli().stderr), expected);
  assert.equal(location(run(["summary", change], root).stderr), expected);
  // Put the incomplete V first so coverage must find the valid V for this AC.
  const extraVerification = journal
    .replace(
      "    verification: V-1",
      "    verification: V-1\n  - { subject: extra, outcome: passed, source: CI, revision: inputs, verification: V-2 }",
    )
    .replace(
      "#### V-1:",
      `#### V-2: Повтор\n\n- Verifies:\n  - [${change}/intent/AC-1]\n\n#### V-1:`,
    );
  await write(root, dir + "journal.md", extraVerification);
  const covered = cli();
  assert.equal(covered.status, 0, covered.text);
  assert.equal(
    await fs.readFile(path.join(root, dir, "plan.md"), "utf8"),
    plan.replace("'in_progress'", "completed"),
  );
  await write(root, dir + "plan.md", plan);
  await write(root, dir + "journal.md", journal);
  const configPath = path.join(root, "viaferrata.toml");
  const originalConfig = await fs.readFile(configPath, "utf8");
  await edit(root, dir + "spec.md", (s) =>
    s.replace("completion_checks: [test]", "completion_checks: [test, build]"),
  );
  assert.match(cli().stderr, /E_COMPLETION_BLOCKED:.*completion_digest/);
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
  assert.match(cli().stderr, /E_COMPLETION_BLOCKED:.*профиль strict/);
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
  const missingTarget = cli()
    .stderr.trim()
    .split("\n")
    .find((line) => line.includes("R-999"));
  assert.ok(missingTarget);
  assert.match(
    missingTarget,
    /intent\.md:[1-9]\d*:[1-9]\d* E_REFERENCE_TARGET: \[reference-target\]/,
  );
  assert.equal(missingTarget.split("E_REFERENCE_TARGET").length, 2);
  await edit(root, dir + "intent.md", (s) => s.replace("srs-000007/R-999", "srs-000007/R-1"));
  const config = await loadConfig(root);
  const complete = () => completeChange(config, change, () => {});
  await t.test(
    "filesystem failure preserves the Plan and cleans the temporary file",
    async (subtest) => {
      subtest.mock.method(fs, "rename", async () => {
        throw Object.assign(new Error("no space"), { code: "ENOSPC" });
      });
      await assert.rejects(complete, { code: "E_IO", message: /no space/ });
      assert.equal(await fs.readFile(path.join(root, dir, "plan.md"), "utf8"), plan);
      assert.equal(
        (await fs.readdir(path.join(root, dir))).some((name) => name.startsWith(".complete-")),
        false,
      );
    },
  );
  await t.test(
    "Plan disappearing before opening the temporary file is a conflict",
    async (subtest) => {
      const originalStat = fs.stat;
      const planPath = path.join(root, dir, "plan.md");
      subtest.mock.method(fs, "stat", async (...args: Parameters<typeof fs.stat>) => {
        if (args[0] === planPath) {
          throw Object.assign(new Error("missing"), { code: "ENOENT", path: planPath });
        }
        return originalStat(...args);
      });
      await assert.rejects(complete, { code: "E_CONFLICT" });
    },
  );
  await t.test("cleanup failure keeps the original IO error", async (subtest) => {
    subtest.mock.method(fs, "rename", async () => {
      throw Object.assign(new Error("no space"), { code: "ENOSPC" });
    });
    subtest.mock.method(fs, "rm", async () => {
      throw Object.assign(new Error("denied"), { code: "EACCES" });
    });
    await assert.rejects(complete, { code: "E_IO", message: /no space.*denied/s });
  });
  for (const file of await fs.readdir(path.join(root, dir))) {
    if (file.startsWith(".complete-")) {
      await fs.unlink(path.join(root, dir, file));
    }
  }
  await t.test(
    "a concurrent edit returns E_CONFLICT and keeps the newer bytes",
    async (subtest) => {
      const planPath = path.join(root, dir, "plan.md");
      const originalOpen = fs.open;
      subtest.mock.method(fs, "open", async (...args: Parameters<typeof fs.open>) => {
        if (String(args[0]).includes(".complete-")) {
          await fs.appendFile(planPath, "\nchanged");
        }
        return originalOpen(...args);
      });
      await assert.rejects(complete, { code: "E_CONFLICT" });
      assert.equal(await fs.readFile(planPath, "utf8"), plan + "\nchanged");
    },
  );
  await write(root, dir + "plan.md", plan);
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

void test("complete distinguishes an absent, incomplete and archived change", async (t) => {
  const config = await loadConfig(await project(t));
  const invoke = (change: string) => completeChange(config, change, () => {});
  await assert.rejects(() => invoke("change-000099"), { code: "E_DOCUMENT_NOT_FOUND" });
  await fs.mkdir(path.join(config.directories.changes, "change-000099"));
  await assert.rejects(() => invoke("change-000099"), { code: "E_STRUCTURE" });

  const change = "change-000042";
  await assert.rejects(() => invoke(change), { code: "E_COMPLETION_BLOCKED" });
  await edit(config.root, "viaferrata/changes/" + change + "/plan.md", (s) =>
    s.replace("not_started", "cancelled"),
  );
  const archive = path.join(config.documentsRoot, "archive", "changes");
  await fs.mkdir(archive, { recursive: true });
  await fs.rename(path.join(config.directories.changes, change), path.join(archive, change));
  await assert.rejects(() => invoke(change), { code: "E_COMPLETION_BLOCKED", message: /архивный/ });
});
