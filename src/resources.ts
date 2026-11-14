import { fileURLToPath } from "node:url";

// Source modules live in src/; emitted modules live in dist/src/.
export const packageRoot = new URL(
  import.meta.url.endsWith(".ts") ? "../" : "../../",
  import.meta.url,
);

export interface InstructionFiles {
  workflow: string;
  templates: string;
}

export const instructionFiles: InstructionFiles = {
  workflow: fileURLToPath(new URL("instructions/workflow.md", packageRoot)),
  templates: fileURLToPath(new URL("templates/README.md", packageRoot)),
};
