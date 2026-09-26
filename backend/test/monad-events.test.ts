import assert from "node:assert/strict";
import test from "node:test";
import {
  decodeEventLog,
  encodeAbiParameters,
  encodeEventTopics,
  parseAbiParameters,
  toEventSelector,
} from "viem";
import {
  monadDelegateAbi,
  monadUndelegateAbi,
  monadWithdrawAbi,
} from "../src/services/monad-events.js";

const delegator = "0x1111111111111111111111111111111111111111" as const;

test("Monad lifecycle ABI uses the protocol's indexed validator/delegator order", () => {
  assert.equal(toEventSelector(monadDelegateAbi), "0xe4d4df1e1827dd28252fd5c3cd7ebccd3da6e0aa31f74c828f3c8542af49d840");
  assert.equal(toEventSelector(monadUndelegateAbi), "0x3e53c8b91747e1b72a44894db10f2a45fa632b161fdcdd3a17bd6be5482bac62");
  assert.equal(toEventSelector(monadWithdrawAbi), "0x63030e4238e1146c63f38f4ac81b2b23c8be28882e68b03f0887e50d0e9bb18f");

  const undelegateTopics = encodeEventTopics({
    abi: [monadUndelegateAbi],
    eventName: "Undelegate",
    args: { validatorId: 17n, delegator },
  });
  assert.equal(BigInt(undelegateTopics[1]!), 17n);
  assert.equal(undelegateTopics[2]!.toLowerCase().slice(-40), delegator.slice(2));

  const decoded = decodeEventLog({
    abi: [monadUndelegateAbi],
    topics: undelegateTopics,
    data: encodeAbiParameters(parseAbiParameters("uint8,uint256,uint64"), [0, 1_000_000_000_000_000_000n, 42n]),
  });
  assert.deepEqual(decoded.args, {
    validatorId: 17n,
    delegator,
    withdrawId: 0,
    amount: 1_000_000_000_000_000_000n,
    activationEpoch: 42n,
  });
});
