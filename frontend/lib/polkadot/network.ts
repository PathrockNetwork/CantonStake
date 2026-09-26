import type { ApiPromise } from "@polkadot/api";

export const polkadotNetwork = process.env.NEXT_PUBLIC_NETWORK_MODE === "mainnet"
  ? {
      name: "Polkadot Asset Hub", symbol: "DOT", decimals: 10, ss58: 0,
      genesis: "0x68d56f15f85d3136970ec16946040bc1752654e906147f7e43e9d539d7c3de2f",
      rpc: process.env.NEXT_PUBLIC_POLKADOT_RPC_URL || "https://polkadot-asset-hub-rpc.polkadot.io",
    }
  : {
      name: "Westend Asset Hub", symbol: "WND", decimals: 12, ss58: 42,
      genesis: "0x67f9723393ef76214df0118c34bbbd3dbebc8ed46a10973a8c969d48fe7598c9",
      rpc: process.env.NEXT_PUBLIC_POLKADOT_RPC_URL || "https://westend-asset-hub-rpc.polkadot.io",
    };

let currentApi: Promise<ApiPromise> | null = null;

export function polkadotApi(): Promise<ApiPromise> {
  if (!currentApi) {
    currentApi = (async () => {
      const { ApiPromise, HttpProvider } = await import("@polkadot/api");
      const api = await ApiPromise.create({ provider: new HttpProvider(polkadotNetwork.rpc), noInitWarn: true });
      await api.isReady;
      if (api.genesisHash.toHex() !== polkadotNetwork.genesis ||
          api.registry.chainDecimals[0] !== polkadotNetwork.decimals ||
          api.registry.chainTokens[0] !== polkadotNetwork.symbol ||
          !api.tx.nominationPools?.join) {
        await api.disconnect();
        throw new Error(`RPC must be ${polkadotNetwork.name} with nomination pools.`);
      }
      return api;
    })().catch((error: unknown) => { currentApi = null; throw error; });
  }
  return currentApi;
}

export async function waitForFinalizedPolkadotExtrinsic(api: ApiPromise, txHash: string, afterHeight: number): Promise<void> {
  let scanned = afterHeight;
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    const head = await api.rpc.chain.getFinalizedHead();
    const height = (await api.rpc.chain.getHeader(head)).number.toNumber();
    for (let blockNumber = scanned + 1; blockNumber <= height; blockNumber++) {
      const hash = await api.rpc.chain.getBlockHash(blockNumber);
      const block = await api.rpc.chain.getBlock(hash);
      const index = block.block.extrinsics.findIndex((item) => item.hash.toHex() === txHash);
      if (index >= 0) {
        const at = await api.at(hash);
        const records = await at.query.system.events() as unknown as Array<{
          phase: { isApplyExtrinsic: boolean; asApplyExtrinsic: { toNumber(): number } };
          event: { section: string; method: string; data: { toString(): string } };
        }>;
        const events = records.filter((record) => record.phase.isApplyExtrinsic && record.phase.asApplyExtrinsic.toNumber() === index);
        const failed = events.find((record) => record.event.section === "system" && record.event.method === "ExtrinsicFailed");
        if (failed) throw new Error(`Polkadot transaction failed on-chain: ${failed.event.data.toString()}`);
        if (!events.some((record) => record.event.section === "system" && record.event.method === "ExtrinsicSuccess")) {
          throw new Error(`Polkadot transaction ${txHash} finalized without a success event.`);
        }
        return;
      }
      scanned = blockNumber;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 3_000));
  }
  throw new Error(`Polkadot transaction ${txHash} was submitted but finality was not confirmed within three minutes. Check the explorer before retrying.`);
}
