import type { Chain } from "viem";

/** Wallet network metadata describes the transaction chain, not the staking
 * asset or protocol. Polygon PoS settlement therefore uses ETH, not POL. */
export function evmWalletChainParameters(chain: Chain) {
  return {
    chainId: `0x${chain.id.toString(16)}`,
    chainName: chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: [...chain.rpcUrls.default.http],
    ...(chain.blockExplorers?.default.url
      ? { blockExplorerUrls: [chain.blockExplorers.default.url] }
      : {}),
  };
}
