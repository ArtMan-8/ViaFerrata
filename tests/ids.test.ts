import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { identity, addressIdentity } from "../src/documents/schema.ts";
import { project, run, write } from "./helpers.ts";

test("six-digit document and bundle IDs include 100000 and reject zero and other widths", () => {
  for (const number of ["000001", "100000", "999999"]) {
    for (const type of ["intent", "spec", "plan", "journal"])
      assert(identity(`change-${number}/${type}`));
    for (const type of ["srs", "research", "adr"])
      assert(identity(`${type}-${number}`));
    assert.deepEqual(addressIdentity(`change-${number}`), {
      bundle: `change-${number}`,
    });
    assert(addressIdentity(`change-${number}/intent/AC-1`));
    assert(addressIdentity(`srs-${number}/R-1`));
  }
  for (const number of [
    "000000",
    "0000",
    "00000",
    "0001",
    "00001",
    "1000000",
  ]) {
    assert.equal(identity(`change-${number}/intent`), null);
    assert.equal(addressIdentity(`change-${number}`), null);
    for (const type of ["srs", "research", "adr"])
      assert.equal(identity(`${type}-${number}`), null);
  }
});

for (const [occupied, next] of [
  ["009999", "010000"],
  ["099999", "100000"],
  ["999998", "999999"],
]) {
  test(`new advances ${occupied} to ${next} within the six-digit range`, async (t) => {
    const root = await project(t, false);
    await write(root, `viaferrata/changes/change-${occupied}`, "reserved");
    const result = run(["new", "Граница диапазона"], root);
    assert.equal(result.status, 0, result.text);
    const intent = await fs.readFile(
      path.join(root, `viaferrata/changes/change-${next}/intent.md`),
      "utf8",
    );
    assert(intent.includes(`id: "change-${next}/intent"`));
    const checked = run(["validate"], root);
    assert.equal(checked.status, 1, checked.text);
    assert.match(checked.text, /E_DRAFT_PLACEHOLDER/);
    assert(!/\bE_ID\b/.test(checked.text), checked.text);
    if (next === "999999") {
      const exhausted = run(["new", "За пределами диапазона"], root);
      assert.equal(exhausted.status, 2, exhausted.text);
      assert.match(exhausted.text, /E_ID_EXHAUSTED/);
    }
  });
}
