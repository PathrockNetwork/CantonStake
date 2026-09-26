import { afterEach, describe, expect, it, vi } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";

vi.mock("../../api", () => ({ fetchValidatorScores: vi.fn(), fetchPositions: vi.fn() }));

import { solanaAdapter } from "../solana";

describe("Solana adapter", () => {
  afterEach(() => vi.restoreAllMocks());
  const wallet = Keypair.generate().publicKey.toBase58();
  const vote = Keypair.generate().publicKey.toBase58();
  const stakeAccount = Keypair.generate().publicKey.toBase58();

  it("builds wallet-owned stake-account action plans without rounding lamports", async () => {
    expect(await solanaAdapter.buildDelegateTx({ validator: vote, delegator: wallet, amount: 1_000_000_001n }))
      .toEqual({ kind: "solana", action: "stake", voteAccount: vote, amountLamports: 1_000_000_001n });
    expect(await solanaAdapter.buildUndelegateTx({ validator: stakeAccount, delegator: wallet, amount: 1_000_000_001n }))
      .toEqual({ kind: "solana", action: "deactivate", stakeAccount });
  });

  it("rejects invalid keys and zero stakes before wallet submission", async () => {
    await expect(solanaAdapter.buildDelegateTx({ validator: "not a key", delegator: wallet, amount: 1n })).rejects.toThrow("Invalid Solana public key");
    await expect(solanaAdapter.buildDelegateTx({ validator: vote, delegator: wallet, amount: 0n })).rejects.toThrow("positive SOL");
  });

  it("rejects portfolio reads from a Solana RPC on the wrong cluster", async () => {
    vi.spyOn(Connection.prototype, "getGenesisHash").mockResolvedValue("wrong-genesis");
    await expect(solanaAdapter.getDelegations(wallet)).rejects.toThrow(/does not match/);
  });
});
