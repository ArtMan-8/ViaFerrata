// Source modules live in src/; emitted modules live in dist/src/.
export const packageRoot = new URL(
  import.meta.url.endsWith(".ts") ? "../" : "../../",
  import.meta.url,
);
