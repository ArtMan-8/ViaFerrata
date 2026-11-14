export default {
  globs: [
    "README.md",
    "AGENTS.md",
    "docs/**/*.md",
    "instructions/**/*.md",
    "templates/**/*.md",
    "viaferrata/**/*.md",
    "src/tests/**/*.md",
  ],
  ignores: ["node_modules/**", "dist/**", ".viaferrata/**", "src/tests/fixtures/**", "*.tgz"],
  config: {
    default: true,
    // Oxfmt owns wrapping and table layout; long logical IDs must remain intact.
    MD013: false,
    MD060: false,
  },
};
