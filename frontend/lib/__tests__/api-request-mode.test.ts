import { afterEach, describe, expect, it, vi } from "vitest";
import { createStakingRequest } from "../api";
import { networkMode } from "../network";

afterEach(() => vi.unstubAllGlobals());

describe("staking request mode", () => {
  it("sends the frontend build mode with every intent", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({
        chain: "monad", clientNetworkMode: networkMode,
      });
      return Response.json({ ok: true, transactionId: "tx", delegator: "party" });
    });
    vi.stubGlobal("fetch", fetchMock);
    await createStakingRequest({
      evmAddress: `0x${"1".repeat(40)}`, amountPol: "1", delegator: "party", chain: "monad", validator: "1",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
