export type PolkadotPoolBinding = {
  wallet: string;
  poolId: number;
  amountPlanck: bigint;
};

export type PolkadotPoolExtrinsic = {
  hash: string;
  signer: string | null;
  section: string;
  method: string;
  success: boolean;
  events: Array<{ section: string; method: string; data: string[] }>;
};

export type PolkadotPoolAction = {
  kind: "join" | "unbond" | "withdraw";
  wallet: string;
  poolId: number;
  amountPlanck: bigint;
  txHash: string;
  blockNumber: number;
  timestamp: Date;
};

/** Reward compounding emits Bonded(newMember=false), not a new position. */
export function isPolkadotLifecycleEvent(event: { section: string; method: string; data: string[] }): boolean {
  return event.section === "nominationPools" && (
    (event.method === "Bonded" && event.data[3] === "true") ||
    event.method === "Unbonded" || event.method === "Withdrawn"
  );
}

function positive(value: string | undefined): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : null;
}

/** Decode only successful wallet-signed nomination-pool extrinsics. Every
 * economic transition must have the matching pallet event in that same
 * extrinsic; a block hash or unrelated pool event is never a proof. */
export function decodePolkadotPoolAction(
  extrinsic: PolkadotPoolExtrinsic,
  binding: PolkadotPoolBinding,
  blockNumber: number,
  timestamp: Date,
): PolkadotPoolAction | null {
  if (!extrinsic.success || extrinsic.signer !== binding.wallet || extrinsic.section !== "nominationPools" ||
      !/^0x[0-9a-fA-F]{64}$/.test(extrinsic.hash) || !Number.isSafeInteger(blockNumber) || blockNumber < 0 ||
      !Number.isFinite(timestamp.getTime())) return null;
  const matching = (method: string) => extrinsic.events.filter((event) =>
    event.section === "nominationPools" && event.method === method &&
    event.data[0] === binding.wallet && event.data[1] === String(binding.poolId));
  const base = { wallet: binding.wallet, poolId: binding.poolId, txHash: extrinsic.hash, blockNumber, timestamp };

  if (extrinsic.method === "join") {
    const events = matching("Bonded");
    if (events.length !== 1 || events[0]!.data[3] !== "true" ||
        positive(events[0]!.data[2]) !== binding.amountPlanck) return null;
    return { ...base, kind: "join", amountPlanck: binding.amountPlanck };
  }
  if (extrinsic.method === "unbond") {
    const events = matching("Unbonded");
    const amount = events.length === 1 ? positive(events[0]!.data[2]) : null;
    const points = events.length === 1 ? positive(events[0]!.data[3]) : null;
    if (!amount || !points) return null;
    return { ...base, kind: "unbond", amountPlanck: amount };
  }
  if (extrinsic.method === "withdrawUnbonded") {
    const withdrawn = matching("Withdrawn");
    const removed = extrinsic.events.filter((event) => event.section === "nominationPools" &&
      event.method === "MemberRemoved" && event.data[0] === String(binding.poolId) && event.data[1] === binding.wallet);
    const amount = withdrawn.length === 1 ? positive(withdrawn[0]!.data[2]) : null;
    if (!amount || removed.length !== 1) return null;
    return { ...base, kind: "withdraw", amountPlanck: amount };
  }
  return null;
}
