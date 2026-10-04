import { decodeAddress, encodeAddress } from "@polkadot/util-crypto";
import { config } from "../config.js";
import { polkadotApi, parsePolkadotPoolKey } from "./polkadot-rpc.js";
import { decodePolkadotPoolAction } from "./polkadot-staking.js";

function walletKey(value: string): string | null {
  try {
    const key = decodeAddress(value);
    return key.length === 32 ? encodeAddress(key, 42) : null;
  } catch { return null; }
}

/** Exact finalized block and extrinsic only. Substrate has no generic tx-by-hash
 * RPC: the block hash is a lookup hint, never proof. It must match the canonical
 * finalized chain, and all call/event/member-state evidence is read on-chain.
 * No block-range guessing, signing, transaction replay or latest-state fallback.
 */
export async function readPolkadotUnbondReceipt(args: {
  wallet: string; pool: string; hash: string; blockHash: string; bondHeight: number;
}): Promise<{ hash: string; blockHash: string; status: "pending" | "settled" | "reverted" }> {
  const poolId = parsePolkadotPoolKey(args.pool);
  if (config.networkMode !== "testnet" || walletKey(args.wallet) !== args.wallet || poolId === null ||
      !/^0x[a-fA-F0-9]{64}$/.test(args.hash) || !/^0x[a-fA-F0-9]{64}$/.test(args.blockHash) ||
      !Number.isSafeInteger(args.bondHeight) || args.bondHeight <= 0) {
    throw new Error("Polkadot recovery requires the verified Westend wallet, pool, native hash, finalized block hash and original bond height");
  }
  const api = await polkadotApi();
  const hash = args.hash.toLowerCase();
  const blockHash = args.blockHash.toLowerCase();
  const [header, finalizedHead] = await Promise.all([api.rpc.chain.getHeader(blockHash), api.rpc.chain.getFinalizedHead()]);
  const height = header.number.toNumber();
  const finalizedHeight = (await api.rpc.chain.getHeader(finalizedHead)).number.toNumber();
  if (!Number.isSafeInteger(height) || height <= args.bondHeight || header.hash.toHex() !== blockHash) {
    throw new Error("Polkadot receipt block is not the supplied block after the original native bond");
  }
  if (height > finalizedHeight) return { hash, blockHash, status: "pending" };
  if ((await api.rpc.chain.getBlockHash(height)).toHex() !== blockHash) throw new Error("Polkadot receipt block is not on the canonical finalized chain");
  // Raw block avoids decoding unrelated v5 extrinsics with the v4 SDK. The
  // tracked transaction alone is decoded using its parent execution runtime.
  const raw = await api.rpc.chain.getBlock.raw(blockHash) as unknown as {
    block?: { header?: { parentHash?: string }; extrinsics?: string[] };
  };
  const parentHash = header.parentHash.toHex();
  if (raw?.block?.header?.parentHash !== parentHash || !Array.isArray(raw.block.extrinsics)) throw new Error("Polkadot receipt block is unavailable");
  const indices = raw.block.extrinsics.flatMap((hex, index) => {
    // Blake2-256 of the complete SCALE extrinsic is its native transaction hash.
    if (!/^0x[a-fA-F0-9]+$/.test(hex) || hex.length % 2 !== 0) throw new Error("Polkadot block contains invalid extrinsic bytes");
    return api.registry.hash(Buffer.from(hex.slice(2), "hex")).toHex() === hash ? [index] : [];
  });
  if (indices.length !== 1) throw new Error("Supplied finalized block does not contain the exact recorded native extrinsic");
  const index = indices[0]!;
  const [parent, at] = await Promise.all([api.at(parentHash), api.at(blockHash)]);
  const extrinsic = parent.registry.createType("Extrinsic", raw.block.extrinsics[index]);
  if (extrinsic.hash.toHex() !== hash || !extrinsic.isSigned || walletKey(extrinsic.signer.toString()) !== args.wallet ||
      extrinsic.method.section !== "nominationPools" || extrinsic.method.method !== "unbond" || extrinsic.method.args.length !== 2 ||
      walletKey(extrinsic.method.args[0]!.toString()) !== args.wallet || !/^[1-9]\d*$/.test(extrinsic.method.args[1]!.toString())) {
    throw new Error("Polkadot receipt is not this wallet's direct nomination-pool unbond");
  }
  const member = await parent.query.nominationPools.poolMembers(args.wallet) as unknown as {
    isNone: boolean; unwrap(): { poolId: { toNumber(): number }; points: { toString(): string } };
  };
  if (member.isNone || member.unwrap().poolId.toNumber() !== poolId ||
      member.unwrap().points.toString() !== extrinsic.method.args[1]!.toString()) {
    throw new Error("Polkadot receipt does not unbond the full historical membership of this exact pool");
  }
  const records = await at.query.system.events() as unknown as Array<{
    phase: { isApplyExtrinsic: boolean; asApplyExtrinsic: { toNumber(): number } };
    event: { section: string; method: string; data: { toArray(): Array<{ toString(): string }> } };
  }>;
  const events = records.filter(record => record.phase.isApplyExtrinsic && record.phase.asApplyExtrinsic.toNumber() === index)
    .map(record => ({ section: record.event.section, method: record.event.method,
      data: record.event.data.toArray().map(value => value.toString()) }));
  const success = events.filter(event => event.section === "system" && event.method === "ExtrinsicSuccess");
  const failure = events.filter(event => event.section === "system" && event.method === "ExtrinsicFailed");
  if (failure.length === 1 && success.length === 0) return { hash, blockHash, status: "reverted" };
  if (success.length !== 1 || failure.length !== 0) throw new Error("Polkadot receipt has no unambiguous finalized dispatch result");
  const poolEvents = events.map(event => event.section === "nominationPools" && event.method === "Unbonded"
    ? { ...event, data: [walletKey(event.data[0] ?? "") ?? "", ...event.data.slice(1)] } : event);
  const unbonded = poolEvents.filter(event => event.section === "nominationPools" && event.method === "Unbonded" &&
    event.data[0] === args.wallet && event.data[1] === String(poolId));
  if (unbonded.length !== 1 || unbonded[0]!.data[3] !== extrinsic.method.args[1]!.toString()) {
    throw new Error("Polkadot unbond event does not match the exact signed pool points");
  }
  const action = decodePolkadotPoolAction({ hash, signer: args.wallet, section: "nominationPools", method: "unbond", success: true,
    events: poolEvents }, { wallet: args.wallet, poolId, amountPlanck: 0n }, height,
    new Date(Number((await at.query.timestamp.now()).toString())));
  const state = await at.query.nominationPools.poolMembers(args.wallet) as unknown as {
    isNone: boolean; unwrap(): { poolId: { toNumber(): number }; points: { toString(): string }; unbondingEras: { size: number } };
  };
  if (!action || state.isNone || state.unwrap().poolId.toNumber() !== poolId || state.unwrap().points.toString() !== "0" ||
      state.unwrap().unbondingEras.size === 0) throw new Error("Polkadot receipt does not prove a complete historical pool unbond");
  return { hash, blockHash, status: "settled" };
}
