export const MIN_NODE_VERSION = "24.22.2";

function parseVersion(version) {
  if (typeof version !== "string") {
    throw new TypeError("version must be a string");
  }

  const normalized = version.trim().replace(/^v/, "");
  if (normalized.length === 0) {
    throw new TypeError(`invalid version: "${version}"`);
  }

  const [withoutBuild] = normalized.split("+");
  const [core, ...prereleaseParts] = withoutBuild.split("-");
  const components = core.split(".");

  if (components.length < 1 || components.length > 3) {
    throw new TypeError(`invalid version: "${version}"`);
  }

  const [major, minor = "0", patch = "0"] = components;
  const numbers = [major, minor, patch].map((component) => {
    if (!/^\d+$/.test(component)) {
      throw new TypeError(`invalid version: "${version}"`);
    }

    return Number(component);
  });

  return {
    major: numbers[0],
    minor: numbers[1],
    patch: numbers[2],
    prerelease: prereleaseParts.length > 0 ? prereleaseParts.join("-") : null,
  };
}

export function compareVersions(left, right) {
  const lv = parseVersion(left);
  const rv = parseVersion(right);

  for (const key of ["major", "minor", "patch"]) {
    if (lv[key] !== rv[key]) {
      return lv[key] < rv[key] ? -1 : 1;
    }
  }

  if (lv.prerelease === rv.prerelease) {
    return 0;
  }

  if (lv.prerelease === null) {
    return 1;
  }

  if (rv.prerelease === null) {
    return -1;
  }

  return lv.prerelease < rv.prerelease ? -1 : 1;
}

export function isSupportedNodeVersion(current, minimum = MIN_NODE_VERSION) {
  return compareVersions(current, minimum) >= 0;
}
