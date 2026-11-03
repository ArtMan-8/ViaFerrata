import { readFileSync } from "node:fs";

interface PackageMetadata {
  version: string;
}

const packageUrl = new URL("../package.json", import.meta.url);

function readVersion(): string {
  const metadata = JSON.parse(
    readFileSync(packageUrl, "utf8"),
  ) as PackageMetadata;
  return metadata.version;
}

export function main(argv: string[]): number {
  if (argv.length === 1 && argv[0] === "--version") {
    console.log(`viaferrata ${readVersion()}`);
    return 0;
  }

  if (argv.length === 0) {
    console.error('vf: no command given; try "vf --version"');
    return 2;
  }

  const unknown =
    argv[0] === "--version" && argv.length > 1 ? argv[1] : argv[0];
  console.error(`vf: unknown option "${unknown}"; try "vf --version"`);
  return 2;
}
