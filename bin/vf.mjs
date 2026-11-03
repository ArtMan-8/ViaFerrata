#!/usr/bin/env node
import process from "node:process";
import { isSupportedNodeVersion, MIN_NODE_VERSION } from "./version.mjs";

if (!isSupportedNodeVersion(process.versions.node)) {
  process.stderr.write(
    `viaferrata requires Node.js >= ${MIN_NODE_VERSION}; current is ${process.versions.node}. Install Node.js: https://nodejs.org/en/download\n`,
  );
  process.exitCode = 1;
} else {
  const { main } = await import(new URL("../src/cli.ts", import.meta.url).href);
  process.exitCode = main(process.argv.slice(2));
}
