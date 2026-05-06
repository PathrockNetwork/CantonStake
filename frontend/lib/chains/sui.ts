/**
 * Sui chain adapter — `0x3::sui_system::request_add_stake` /
 * `request_withdraw_stake`. Tx builder returns a `kind: "sui"` envelope
 * that the user's wallet (via @mysten/dapp-kit) executes; the backend
 * keeper builds the same envelope and signs with its keypair.
 *
 * Read paths use the JSON-RPC `suix_getLatestSuiSystemState` (validators)
 * and `suix_getStakes` (positions). Pattern lifted from
 * references/sui-staker-ui/src/StakingForm.tsx.
 */

import {
  ChainAdapterError,
  type IChainAdapter,
  type Position,
  type UnsignedTx,
  type Validator,
} from "./types";
import { fetchValidatorScores, type ValidatorScore } from "../api";

const SUI_CHAIN_ID = "sui";
// Sui Testnet — same `0x3::sui_system` module as mainnet (system objects
// at well-known addresses are constant across networks).
const SUI_RPC = "https://fullnode.testnet.sui.io:443";
const SUI_SYSTEM_STATE = "0x5";
const SUI_SYSTEM_MODULE = "0x3::sui_system";
// Sui testnet epoch is ~24h on testnet too; stakes mature at the next
// epoch boundary.
const UNBONDING_SECONDS = 24 * 60 * 60;

function networkError(message: string, cause?: unknown) {
  return new ChainAdapterError("NETWORK", message, cause);
}

function toAdapterError(message: string, cause: unknown) {
  if (cause instanceof ChainAdapterError) return cause;
  return networkError(message, cause);
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(SUI_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) throw networkError(`Sui RPC ${method} ${res.status}`);
  const body = (await res.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw networkError(body.error.message);
  return body.result as T;
}

interface SuiValidator {
  suiAddress?: string;
  name?: string;
  commissionRate?: string;
  votingPower?: string;
  stakingPoolSuiBalance?: string;
  isActive?: boolean;
}

interface SuiStakeRow {
  validatorAddress: string;
  stakes: Array<{
    principal: string;
    stakedSuiId: string;
    status: string;
    estimatedReward?: string;
  }>;
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
      const stakes = await rpc<SuiStakeRow[]>("suix_getStakes", [address]);
      const out: Position[] = [];
      for (const row of stakes ?? []) {
        for (const s of row.stakes) {
          const amount = BigInt(s.principal || "0");
          if (amount === 0n) continue;
          out.push({
            validator: row.validatorAddress,
            amount,
            status: s.status === "Active" ? "bonded" : "unbonding",
          });
        }
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

  async buildUndelegateTx({ validator, amount, delegator }) {
    return {
      kind: "sui",
      tx: {
        target: `${SUI_SYSTEM_MODULE}::request_withdraw_stake`,
        systemState: SUI_SYSTEM_STATE,
        validator,
        delegator,
        // The actual `request_withdraw_stake` move call takes a
        // StakedSui object id. The signing client (frontend wallet or
        // backend keeper) resolves the user's StakedSui id from
        // suix_getStakes before submitting.
        amountMist: amount.toString(),
      },
    } satisfies UnsignedTx;
  },

  async buildClaimTx({ validator, delegator }) {
    // Sui auto-mints rewards into the StakedSui object; "claim" is
    // effectively a re-stake of the matured rewards. We model it as a
    // delegate call with a 0 amount so the keeper can resolve and
    // restake at execution time.
    return {
      kind: "sui",
      tx: {
        target: `${SUI_SYSTEM_MODULE}::request_add_stake`,
        systemState: SUI_SYSTEM_STATE,
        validator,
        delegator,
        amountMist: "0",
      },
    } satisfies UnsignedTx;
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
