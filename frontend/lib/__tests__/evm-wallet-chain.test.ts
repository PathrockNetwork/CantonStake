import { describe, expect, it } from "vitest";
import { bscTestnet, mainnet, monadTestnet, sepolia } from "viem/chains";
import { evmWalletChainParameters } from "../evm-wallet-chain";
import { successfulEvmSettlementHash } from "../evm-settlement";

describe("EVM transaction-chain metadata", () => {
  it.each([mainnet, sepolia])("uses ETH gas and the explorer homepage for $name settlement", (chain) => {
    expect(evmWalletChainParameters(chain)).toMatchObject({
      chainId: `0x${chain.id.toString(16)}`,
      chainName: chain.name,
      nativeCurrency: { symbol: "ETH", decimals: 18 },
      blockExplorerUrls: [chain.blockExplorers.default.url],
    });
  });
  it("uses each native EVM network's own gas token", () => {
    expect(evmWalletChainParameters(bscTestnet).nativeCurrency.symbol).toBe("tBNB");
    expect(evmWalletChainParameters(monadTestnet).nativeCurrency.symbol).toBe("MON");
  });
});

describe("EVM execution confirmation", () => {
  it("does not mistake a returned reverted receipt for successful execution", () => {
    expect(successfulEvmSettlementHash()).toBeNull();
    expect(successfulEvmSettlementHash({ status: "reverted", transactionHash: "0xoriginal" })).toBeNull();
  });
  it("uses the actual settled hash, including a gas-repriced replacement", () => {
    expect(successfulEvmSettlementHash({ status: "success", transactionHash: "0xrepriced" }, "repriced")).toBe("0xrepriced");
  });
  it("does not count a successful cancellation or different call as settlement", () => {
    const receipt = { status: "success" as const, transactionHash: "0xcancellation" };
    expect(successfulEvmSettlementHash(receipt, "cancelled")).toBeNull();
    expect(successfulEvmSettlementHash(receipt, "replaced")).toBeNull();
  });
});
