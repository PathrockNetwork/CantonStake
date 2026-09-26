import { afterEach, describe, expect, it, vi } from "vitest";
import { getStakeActivation } from "@anza-xyz/solana-rpc-get-stake-activation";
import { Connection, PublicKey } from "@solana/web3.js";
import { solanaNetwork } from "./network";
import { readSolanaStakeActivation } from "./stake-activation";

vi.mock("@anza-xyz/solana-rpc-get-stake-activation", () => ({ getStakeActivation: vi.fn() }));
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

const account = new PublicKey("25R5p1Qoe4BWW4ru7MQSNxxAzdiPN7zAunpCuF8q5iTz");

describe("Solana stake activation", () => {
  it("uses client-side history calculation only on the selected cluster", async () => {
    const connection = { getGenesisHash: vi.fn().mockResolvedValue(solanaNetwork.genesis) } as unknown as Connection;
    vi.mocked(getStakeActivation).mockResolvedValue({ status: "inactive", active: 0n, inactive: 1_000n });
    await expect(readSolanaStakeActivation(account, connection)).resolves.toEqual({
      state: "inactive", active: 0n, inactive: 1_000n,
    });
    expect(getStakeActivation).toHaveBeenCalledWith(connection, account);
  });

  it("rejects a different cluster before reading stake history", async () => {
    const connection = { getGenesisHash: vi.fn().mockResolvedValue("wrong-genesis") } as unknown as Connection;
    await expect(readSolanaStakeActivation(account, connection)).rejects.toThrow(/does not match/);
    expect(getStakeActivation).not.toHaveBeenCalled();
  });

  it("provides Buffer to the browser-side activation calculation", async () => {
    vi.stubGlobal("Buffer", undefined);
    const connection = { getGenesisHash: vi.fn().mockResolvedValue(solanaNetwork.genesis) } as unknown as Connection;
    vi.mocked(getStakeActivation).mockImplementation(async () => {
      expect(globalThis.Buffer).toBeDefined();
      return { status: "inactive", active: 0n, inactive: 1n };
    });
    await readSolanaStakeActivation(account, connection);
  });
});
