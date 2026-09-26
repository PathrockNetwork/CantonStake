/**
 * Sui chain adapter — `0x3::sui_system::request_add_stake` /
 * `request_withdraw_stake`. Tx builder returns a `kind: "sui"` envelope
 * that the user's wallet (via @mysten/dapp-kit-react) executes; the backend
 * keeper builds the same envelope and signs with its keypair.
 *
 * Owned stake receipts are read through Sui GraphQL. The retired JSON-RPC
 * `suix_getStakes` method is not available on current public mainnet nodes.
 */

import {
  ChainAdapterError,
  type IChainAdapter,
  type Position,
  type UnsignedTx,
  type Validator,
} from "./types";
import { fetchValidatorScores, type ValidatorScore } from "../api";
import { assertSuiNetworkIdentifier, suiNetwork } from "../sui/network";

const SUI_CHAIN_ID = "sui";
// Sui Testnet — same `0x3::sui_system` module as mainnet (system objects
// at well-known addresses are constant across networks).
const SUI_SYSTEM_STATE = "0x5";
const SUI_SYSTEM_MODULE = "0x3::sui_system";
// request_withdraw_stake transfers principal in the same transaction.
const UNBONDING_SECONDS = 0;

function networkError(message: string, cause?: unknown) {
  return new ChainAdapterError("NETWORK", message, cause);
}

function toAdapterError(message: string, cause: unknown) {
  if (cause instanceof ChainAdapterError) return cause;
  return networkError(message, cause);
}

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(suiNetwork.graphql, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw networkError(`Sui GraphQL returned ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (body.errors?.length || !body.data) throw networkError(body.errors?.map((e) => e.message).join("; ") ?? "Sui GraphQL returned no data");
  return body.data;
}

export const suiAdapter: IChainAdapter = {
  chainId: SUI_CHAIN_ID,

  async getValidators(): Promise<Validator[]> {
    try {
      const snap = await fetchValidatorScores("sui");
      return snap.validators.map((v: ValidatorScore) => ({
        address: v.address,
        name: v.name,
        apr: 3.5 * (1 - v.commissionPct / 100),
        commission: v.commissionPct,
        uptime: v.uptimePct,
      }));
    } catch (cause) {
      throw toAdapterError("Failed to load Sui validators.", cause);
    }
  },

  async getDelegations(address: string): Promise<Position[]> {
    try {
      const out: Position[] = [];
      let cursor: string | null = null;
      for (let pageIndex = 0; pageIndex < 20; pageIndex++) {
        const data: {
          chainIdentifier?: string;
          epoch?: { epochId?: number };
          address?: { objects?: { nodes?: Array<{ contents?: { json?: {
            pool_id?: string; principal?: string; stake_activation_epoch?: string;
          } } }>; pageInfo?: { hasNextPage?: boolean; endCursor?: string | null } } };
        } = await gql(`query($owner: SuiAddress!, $after: String) {
          chainIdentifier
          epoch { epochId }
          address(address: $owner) { objects(first: 50, after: $after,
            filter: {type: "0x3::staking_pool::StakedSui"}) {
            nodes { contents { json } }
            pageInfo { hasNextPage endCursor }
          } }
        }`, { owner: address, after: cursor });
        try {
          assertSuiNetworkIdentifier(data.chainIdentifier);
        } catch (cause) {
          throw networkError("Sui GraphQL does not match this app's selected network.", cause);
        }
        const page = data.address?.objects;
        if (!page?.nodes || !page.pageInfo) throw new Error("Sui stake object query returned no page");
        for (const node of page.nodes) {
          const stake = node.contents?.json;
          if (!stake?.pool_id || !stake.principal || !/^\d+$/.test(stake.principal)) continue;
          const amount = BigInt(stake.principal);
          if (amount <= 0n) continue;
          const activeAt = Number(stake.stake_activation_epoch);
          out.push({ validator: stake.pool_id, amount,
            status: Number.isSafeInteger(activeAt) && (data.epoch?.epochId ?? 0) >= activeAt ? "bonded" : "pending" });
        }
        if (!page.pageInfo.hasNextPage) break;
        if (!page.pageInfo.endCursor || page.pageInfo.endCursor === cursor) throw new Error("Sui stake object pagination stalled");
        if (pageIndex === 19) throw new Error("Sui stake object pagination exceeded 20 pages");
        cursor = page.pageInfo.endCursor;
      }
      return out;
    } catch (cause) {
      throw toAdapterError(
        `Failed to load Sui delegations for ${address}.`,
        cause,
      );
    }
  },

  async buildDelegateTx({ validator, amount, delegator }) {
    return {
      kind: "sui",
      tx: {
        target: `${SUI_SYSTEM_MODULE}::request_add_stake`,
        systemState: SUI_SYSTEM_STATE,
        validator,
        delegator,
        amountMist: amount.toString(),
      },
    } satisfies UnsignedTx;
  },

  async buildUndelegateTx() {
    throw new ChainAdapterError("NETWORK", "Sui unstaking requires the tracked StakedSui receipt ID; use the connected wallet's unstake action.");
  },

  async buildClaimTx() {
    throw new ChainAdapterError("UNBONDING_PERIOD", "Sui returns principal during request_withdraw_stake; no second claim transaction exists.");
  },

  async estimateGas() {
    // Sui gas is sub-cent; the wallet kit estimates accurately at sign time.
    return 1_000_000n;
  },

  watchPosition(address, cb) {
    let cancelled = false;
    const tick = async () => {
      try {
        const positions = await suiAdapter.getDelegations(address);
        if (!cancelled) {
          cb(
            positions[0] ?? {
              validator: "",
              amount: 0n,
              status: "released",
            },
          );
        }
      } catch {
        // keep going
      }
    };
    void tick();
    const id = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  },
};

export const suiUnbondingSeconds = UNBONDING_SECONDS;
export const suiSystemStateObject = SUI_SYSTEM_STATE;
