import { defineConfig } from "oxfmt";

export default defineConfig({
  proseWrap: "preserve",
  sortImports: {
    groups: [
      ["type-builtin", "value-builtin"],
      ["type-external", "value-external"],
      ["type-internal", "value-internal", "type-subpath", "value-subpath"],
      ["type-parent", "value-parent", "type-sibling", "value-sibling", "type-index", "value-index"],
      "unknown",
    ],
    newlinesBetween: true,
  },
  sortPackageJson: {
    sortScripts: true,
  },
  ignorePatterns: [
    "node_modules/**",
    "dist/**",
    ".viaferrata/**",
    "src/tests/fixtures/**",
    "*.tgz",
  ],
});
