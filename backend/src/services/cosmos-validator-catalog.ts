import { QueryClient, setupMintExtension, setupStakingExtension } from "@cosmjs/stargate";
import { connectComet } from "@cosmjs/tendermint-rpc";
import type { QueryValidatorsResponse } from "cosmjs-types/cosmos/staking/v1beta1/query";
import { assertCosmosChainIdentity, type CosmosChain } from "./native-network.js";

type ValidatorPage = Pick<QueryValidatorsResponse, "validators" | "pagination">;

/**
 * x/staking protobuf encodes LegacyDec as an integer scaled by 10^18.
 * Unlike REST JSON, CosmJS's protobuf query leaves this string in atomics.
 * See cosmos-sdk/math/legacy_dec.go (LegacyPrecision and Marshal).
 */
export function cosmosCommissionPercent(rate: string | undefined): number {
  if (typeof rate !== "string" || !/^\d{1,19}$/.test(rate)) {
    throw new Error("Missing or malformed Cosmos protobuf commission rate");
  }
  const atomics = BigInt(rate);
  if (atomics > 1_000_000_000_000_000_000n) {
    throw new Error("Cosmos commission rate exceeds 100 percent");
  }
  return Number(atomics) / 1e16;
}

/** Exhaust the bonded set; a single page biases concentration scores and hides pools. */
export async function collectBondedValidators(
  getPage: (key?: Uint8Array) => Promise<ValidatorPage>,
): Promise<QueryValidatorsResponse["validators"]> {
  const validators: QueryValidatorsResponse["validators"] = [];
  const seenKeys = new Set<string>();
  let key: Uint8Array | undefined;
  for (let page = 0; page < 50; page++) {
    const result = await getPage(key);
    validators.push(...result.validators);
    const nextKey = result.pagination?.nextKey;
    if (!nextKey?.length) return validators;
    const marker = Buffer.from(nextKey).toString("hex");
    if (seenKeys.has(marker)) throw new Error("Cosmos validator pagination stalled");
    seenKeys.add(marker);
    key = nextKey;
  }
  throw new Error("Cosmos validator pagination exceeded 50 pages");
}

export async function listCosmosBondedValidators(
  chain: CosmosChain,
  rpcUrl: string,
): Promise<QueryValidatorsResponse["validators"]> {
  const comet = await connectComet(rpcUrl);
  try {
    const status = await comet.status();
    assertCosmosChainIdentity(chain, status.nodeInfo.network, status.syncInfo.catchingUp);
    const query = QueryClient.withExtensions(comet, setupStakingExtension);
    return await collectBondedValidators((key) => query.staking.validators("BOND_STATUS_BONDED", key));
  } finally {
    comet.disconnect();
  }
}

export async function readCosmosInflationAndPool(rpcUrl: string): Promise<{
  inflation: number;
  bonded: number;
  notBonded: number;
}> {
  const comet = await connectComet(rpcUrl);
  try {
    const status = await comet.status();
    assertCosmosChainIdentity("cosmos", status.nodeInfo.network, status.syncInfo.catchingUp);
    const query = QueryClient.withExtensions(comet, setupMintExtension, setupStakingExtension);
    const [inflation, pool] = await Promise.all([query.mint.inflation(), query.staking.pool()]);
    return {
      inflation: Number(inflation.toString()),
      bonded: Number(pool.pool.bondedTokens),
      notBonded: Number(pool.pool.notBondedTokens),
    };
  } finally {
    comet.disconnect();
  }
}
