import { ApiPromise, HttpProvider } from "@polkadot/api";
import { config } from "../config.js";

// These are the Asset Hub genesis hashes, not the relay-chain hashes.
export const POLKADOT_ASSET_HUB = {
  testnet: { genesis: "0x67f9723393ef76214df0118c34bbbd3dbebc8ed46a10973a8c969d48fe7598c9", decimals: 12, symbol: "WND" },
  mainnet: { genesis: "0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f", decimals: 10, symbol: "DOT" },
} as const;

let apiPromise: Promise<ApiPromise> | null = null;

export async function polkadotApi(): Promise<ApiPromise> {
  if (!apiPromise) {
    apiPromise = (async () => {
      const api = await ApiPromise.create({ provider: new HttpProvider(config.polkadotRpcUrl), noInitWarn: true });
      await api.isReady;
      const expected = POLKADOT_ASSET_HUB[config.networkMode];
      if (api.genesisHash.toHex() !== expected.genesis ||
          api.registry.chainDecimals[0] !== expected.decimals ||
          api.registry.chainTokens[0] !== expected.symbol ||
          !api.tx.nominationPools?.join || !api.tx.nominationPools?.unbond ||
          !api.tx.nominationPools?.withdrawUnbonded) {
        await api.disconnect();
        throw new Error(`Polkadot RPC must be ${config.networkMode} Asset Hub with nomination pools`);
      }
      return api;
    })().catch((error: unknown) => {
      apiPromise = null;
      throw error;
    });
  }
  return apiPromise;
}

export function polkadotPoolKey(poolId: number | string): string {
  return `pool:${poolId}`;
}

export function parsePolkadotPoolKey(value: string): number | null {
  if (!/^pool:[1-9]\d*$/.test(value)) return null;
  const id = Number(value.slice(5));
  return Number.isSafeInteger(id) ? id : null;
}
