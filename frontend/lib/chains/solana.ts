import { Connection, PublicKey, StakeProgram } from "@solana/web3.js";
import { fetchPositions, fetchValidatorScores } from "../api";
import { assertSolanaGenesis, solanaNetwork } from "../solana/network";
import { readSolanaStakeActivation } from "../solana/stake-activation";
import { ChainAdapterError, type IChainAdapter, type Position, type UnsignedTx, type Validator } from "./types";

const connection = new Connection(solanaNetwork.rpc, "finalized");

function publicKey(address: string): PublicKey {
  try { return new PublicKey(address); }
  catch { throw new ChainAdapterError("NETWORK", "Invalid Solana public key"); }
}

export const solanaAdapter: IChainAdapter = {
  chainId: "solana",

  async getValidators(): Promise<Validator[]> {
    const scores = await fetchValidatorScores("solana");
    return scores.validators.map((score) => ({
      address: score.address, name: score.name, apr: 0,
      commission: score.commissionPct, uptime: score.uptimePct,
    }));
  },

  async getDelegations(address: string): Promise<Position[]> {
    publicKey(address);
    assertSolanaGenesis(await connection.getGenesisHash());
    const rows = (await fetchPositions(address)).filter((row) => row.chainMeta?.chain === "solana" &&
      row.argument.status !== "Released" && !!row.chainMeta.validatorShare);
    const result: Position[] = [];
    for (const row of rows) {
      const stakeAccount = publicKey(row.chainMeta!.validatorShare!);
      const info = await connection.getParsedAccountInfo(stakeAccount, "finalized");
      if (!info.value || !info.value.owner.equals(StakeProgram.programId)) continue;
      const activation = await readSolanaStakeActivation(stakeAccount);
      const rent = await connection.getMinimumBalanceForRentExemption(StakeProgram.space);
      const amount = BigInt(Math.max(0, info.value.lamports - rent));
      result.push({
        validator: row.chainMeta?.validatorAddress ?? "",
        amount,
        status: activation.state === "deactivating" || row.argument.status === "Unbonding" ? "unbonding" : "bonded",
      });
    }
    return result;
  },

  async buildDelegateTx({ validator, amount }) {
    publicKey(validator);
    if (amount <= 0n) throw new ChainAdapterError("INSUFFICIENT_BALANCE", "Enter a positive SOL amount");
    return { kind: "solana", action: "stake", voteAccount: validator, amountLamports: amount } satisfies UnsignedTx;
  },

  async buildUndelegateTx({ validator }) {
    publicKey(validator);
    return { kind: "solana", action: "deactivate", stakeAccount: validator } satisfies UnsignedTx;
  },

  async buildClaimTx({ validator }) {
    const account = publicKey(validator);
    const activation = await readSolanaStakeActivation(account);
    if (activation.state !== "inactive") throw new ChainAdapterError("UNBONDING_PERIOD", "Solana stake has not cooled down yet");
    return { kind: "solana", action: "withdraw", stakeAccount: validator } satisfies UnsignedTx;
  },

  async estimateGas(tx) {
    if (tx.kind !== "solana") throw new ChainAdapterError("NETWORK", "Not a Solana transaction");
    return 10_000n;
  },

  watchPosition(address, cb) {
    let cancelled = false;
    const tick = async () => {
      try {
        const positions = await solanaAdapter.getDelegations(address);
        if (!cancelled) cb(positions[0] ?? { validator: "", amount: 0n, status: "released" });
      } catch { /* retry on temporary RPC/indexer failure */ }
    };
    void tick();
    const timer = setInterval(tick, 30_000);
    return () => { cancelled = true; clearInterval(timer); };
  },
};
