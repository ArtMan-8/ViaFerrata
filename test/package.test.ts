import { deepEqual, equal, match, ok } from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { MIN_NODE_VERSION } from "../bin/version.mjs";

const root = new URL("..", import.meta.url);

function asRecord(value: unknown): Record<string, unknown> {
  ok(value !== null && typeof value === "object" && !Array.isArray(value));
  return value as Record<string, unknown>;
}

function readJson(relativePath: string): Record<string, unknown> {
  return asRecord(
    JSON.parse(readFileSync(new URL(relativePath, root), "utf8")),
  );
}

test("AC-1: manifest is a private ESM CLI with only dev dependencies", () => {
  const manifest = readJson("package.json");

  equal(manifest.name, "viaferrata");
  equal(manifest.version, "0.0.0");
  equal(typeof manifest.description, "string");
  ok((manifest.description as string).length > 0);
  equal(manifest.license, "MIT");
  equal(manifest.private, true);
  equal(manifest.type, "module");
  equal(asRecord(manifest.engines).node, `>=${MIN_NODE_VERSION}`);
  equal(asRecord(manifest.bin).vf, "./bin/vf.mjs");
  equal(manifest.dependencies, undefined);

  const devDependencies = asRecord(manifest.devDependencies);
  deepEqual(Object.keys(devDependencies).sort(), ["@types/node", "typescript"]);
  equal(devDependencies.typescript, "7.0.2");
  match(String(devDependencies["@types/node"]), /^[\^~]?24\.\d+\.\d+$/);

  const scripts = asRecord(manifest.scripts);
  for (const name of ["test", "typecheck", "start"]) {
    equal(typeof scripts[name], "string", `script ${name} is missing`);
    const command = scripts[name] as string;
    for (const token of ["&&", "||", "|", "$(", ">", "<", "`"]) {
      ok(
        !command.includes(token),
        `script ${name} contains shell syntax ${token}`,
      );
    }
  }

  ok(
    existsSync(new URL("package-lock.json", root)),
    "package-lock.json is missing",
  );

  const binPath = new URL("bin/vf.mjs", root);
  ok(existsSync(binPath), "bin/vf.mjs is missing");
  if (process.platform !== "win32") {
    ok((statSync(binPath).mode & 0o111) !== 0, "bin/vf.mjs is not executable");
  }

  const binSource = readFileSync(binPath, "utf8");
  ok(
    binSource.startsWith("#!/usr/bin/env node\n"),
    "bin/vf.mjs must start with a shebang and LF",
  );
  ok(!binSource.includes("\r"), "bin/vf.mjs must use LF line endings");
});

test("AC-2: TypeScript configuration enforces erasable ESM", () => {
  const tsconfig = readJson("tsconfig.json");
  const options = asRecord(tsconfig.compilerOptions);

  equal(options.target, "ES2024");
  deepEqual(options.lib, ["ES2024"]);
  equal(options.module, "nodenext");
  equal(options.moduleResolution, "nodenext");
  equal(options.noEmit, true);
  equal(options.erasableSyntaxOnly, true);
  equal(options.verbatimModuleSyntax, true);
  equal(options.strict, true);
  equal(options.allowImportingTsExtensions, true);
  deepEqual(options.types, ["node"]);
  deepEqual(tsconfig.include, ["src/**/*.ts", "test/**/*.ts"]);
});

test("the JS minimum Node version matches .node-version and engines.node", () => {
  const nodeVersion = readFileSync(
    new URL(".node-version", root),
    "utf8",
  ).trim();

  equal(nodeVersion, MIN_NODE_VERSION);
  equal(MIN_NODE_VERSION, "24.22.2");
});
