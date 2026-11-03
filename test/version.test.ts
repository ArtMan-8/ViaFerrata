import { equal, throws } from "node:assert/strict";
import { test } from "node:test";
import { compareVersions, isSupportedNodeVersion } from "../bin/version.mjs";

test("compares numeric major.minor.patch components", () => {
  equal(compareVersions("24.22.2", "24.22.2"), 0);
  equal(compareVersions("22.12.0", "24.22.2"), -1);
  equal(compareVersions("24.21.99", "24.22.0"), -1);
  equal(compareVersions("24.22.1", "24.22.2"), -1);
  equal(compareVersions("24.23.0", "24.22.2"), 1);
  equal(compareVersions("25.0.0", "24.22.2"), 1);
});

test("treats missing components as zero", () => {
  equal(compareVersions("24.22", "24.22.0"), 0);
  equal(compareVersions("24", "24.0.0"), 0);
  equal(compareVersions("24.22.1", "24.22"), 1);
});

test("treats a prerelease as lower than the same release", () => {
  equal(compareVersions("24.22.2-rc.1", "24.22.2"), -1);
  equal(compareVersions("24.22.2", "24.22.2-rc.1"), 1);
  equal(compareVersions("24.22.2-rc.1", "24.22.2-rc.2"), -1);
});

test("ignores build metadata", () => {
  equal(compareVersions("24.22.2+build.7", "24.22.2"), 0);
});

test("rejects malformed versions", () => {
  throws(() => compareVersions("not-a-version", "24.22.2"), TypeError);
  throws(() => compareVersions("24.x.2", "24.22.2"), TypeError);
});

test("isSupportedNodeVersion compares against the minimum by default", () => {
  equal(isSupportedNodeVersion("24.22.2"), true);
  equal(isSupportedNodeVersion("24.22.3"), true);
  equal(isSupportedNodeVersion("22.12.0"), false);
  equal(isSupportedNodeVersion("24.22.2-rc.1"), false);
  equal(isSupportedNodeVersion("25.0.0", "26.0.0"), false);
});
