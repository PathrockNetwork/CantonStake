import { describe, expect, it, vi } from "vitest";
import { waitForSolanaFinality } from "../solana/confirmation";

function clock() {
  let time = 0;
  return { now: () => time, sleep: async () => { time += 1_000; }, timeoutMs: 3_000 };
}
describe("Solana failover-safe finality polling", () => {
  it("survives a read outage without rebroadcasting or signing", async () => {
    const connection = { getSignatureStatuses: vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ value: [{ confirmationStatus: "confirmed", err: null }] })
      .mockResolvedValueOnce({ value: [{ confirmationStatus: "finalized", err: null }] }), getBlockHeight: vi.fn() };
    await waitForSolanaFinality(connection, "signed-hash", 100, clock());
    expect(connection.getSignatureStatuses).toHaveBeenCalledTimes(3);
    expect(connection.getBlockHeight).not.toHaveBeenCalled();
  });
  it("keeps the submitted hash in expiration, on-chain failure and timeout errors", async () => {
    await expect(waitForSolanaFinality({ getSignatureStatuses: vi.fn().mockResolvedValue({ value: [null] }),
      getBlockHeight: vi.fn().mockResolvedValue(101) }, "signed-hash", 100, clock())).rejects.toThrow(/signed-hash.*expired/);
    await expect(waitForSolanaFinality({ getSignatureStatuses: vi.fn().mockResolvedValue({ value: [{ err: "failure" }] }),
      getBlockHeight: vi.fn() }, "signed-hash", 100, clock())).rejects.toThrow(/signed-hash.*failed/);
    await expect(waitForSolanaFinality({ getSignatureStatuses: vi.fn().mockRejectedValue(new Error("offline")),
      getBlockHeight: vi.fn() }, "signed-hash", 100, clock())).rejects.toThrow(/signed-hash.*submitted.*Check/);
  });
});
