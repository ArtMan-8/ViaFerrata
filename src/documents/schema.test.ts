import assert from "node:assert/strict";
import test from "node:test";

import { identity, addressIdentity } from "./schema.ts";

void test("six-digit document and bundle IDs include 100000 and reject zero and other widths", () => {
  for (const number of ["000001", "100000", "999999"]) {
    for (const type of ["intent", "spec", "plan", "journal"]) {
      assert(identity(`change-${number}/${type}`));
    }
    for (const type of ["srs", "research", "adr"]) {
      assert(identity(`${type}-${number}`));
    }
    assert.deepEqual(addressIdentity(`change-${number}`), {
      bundle: `change-${number}`,
    });
    assert(addressIdentity(`change-${number}/intent/AC-1`));
    assert(addressIdentity(`srs-${number}/R-1`));
  }
  for (const number of ["000000", "0000", "00000", "0001", "00001", "1000000"]) {
    assert.equal(identity(`change-${number}/intent`), null);
    assert.equal(addressIdentity(`change-${number}`), null);
    for (const type of ["srs", "research", "adr"]) {
      assert.equal(identity(`${type}-${number}`), null);
    }
  }
});
