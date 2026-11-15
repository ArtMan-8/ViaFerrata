export default {
  globs: ["**/*.md"],
  ignores: ["node_modules/**", "dist/**", ".viaferrata/**", "src/tests/fixtures/**"],
  config: {
    default: true,
    // Oxfmt owns wrapping and table layout; long logical IDs must remain intact.
    MD013: false,
    MD060: false,
  },
};
