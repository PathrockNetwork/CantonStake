import assert from "node:assert/strict";
import test from "node:test";
import { CANTON_NETWORKS, dsoPartyFor, isCantonParty, isContractId } from "../src/services/canton-network.js";

test("derives the DSO party from a global synchronizer ID", () => {
  const fingerprint = "1220f22a8b8f2d813c25b9a684dc4dd52b532a0174d8e73a13cdf2baabfff7518337";
  assert.equal(dsoPartyFor(`global-domain::${fingerprint}`), `DSO::${fingerprint}`);
  assert.equal(dsoPartyFor(`other-domain::${fingerprint}`), null);
  assert.equal(dsoPartyFor("global-domain::1220abc"), null);
  assert.equal(dsoPartyFor(""), null);
});

test("shared Canton identifier checks", () => {
  assert.ok(isCantonParty(`Provider::${"1".repeat(68)}`));
  assert.ok(!isCantonParty("Provider::1220") && !isCantonParty(42));
  assert.ok(isContractId("00ab") && !isContractId("0ab") && !isContractId("XYZ"));
  for (const info of Object.values(CANTON_NETWORKS)) assert.ok(dsoPartyFor(info.synchronizerId));
});
