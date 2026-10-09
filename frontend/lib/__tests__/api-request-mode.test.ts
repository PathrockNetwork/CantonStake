import { afterEach, describe, expect, it, vi } from "vitest";
import { createStakingRequest } from "../api";
import { networkMode } from "../network";

afterEach(() => vi.unstubAllGlobals());

describe("staking request mode", () => {
  it("binds native consent to the frontend build mode and sends nothing when the user refuses", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(createStakingRequest({
      evmAddress: `0x${"1".repeat(40)}`, amountPol: "1", delegator: "party", chain: "monad", validator: "1",
    }, async message => {
      expect(message).toContain(`"clientNetworkMode":"${networkMode}"`);
      expect(message).toContain('"chain":"monad"');
      throw new Error("User refused native ownership consent");
    })).rejects.toThrow("User refused native ownership consent");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
