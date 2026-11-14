import { defineConfig } from "oxlint";

export default defineConfig({
  plugins: ["eslint", "typescript", "unicorn", "oxc", "import", "node"],
  categories: {
    correctness: "error",
  },
  options: {
    typeAware: true,
  },
  rules: {
    "no-shadow": "error",
    curly: ["error", "all"],
    eqeqeq: "error",
    "no-else-return": "error",
    "typescript/no-floating-promises": "error",
    "typescript/no-misused-promises": "error",
    "typescript/no-unsafe-assignment": "error",
    "typescript/no-unsafe-argument": "error",
    "typescript/no-unsafe-call": "error",
    "typescript/no-unsafe-member-access": "error",
    "typescript/no-unsafe-return": "error",
  },
  ignorePatterns: [
    "node_modules/**",
    "dist/**",
    ".viaferrata/**",
    "src/tests/fixtures/**",
    "*.tgz",
  ],
});
