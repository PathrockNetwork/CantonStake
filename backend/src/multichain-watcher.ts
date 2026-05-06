/**
 * Multichain event watchers: polls each chain's staking events and
 * translates them into Canton Daml choices.
 *
 * Supported chains:
 * - Polygon (Amoy): MockValidatorShare ShareMinted events
 * - Moonbeam (Moonbase Alpha): ParachainStaking Delegated events
 * - Monad (Testnet): Staking Delegate events
 * - Cosmos (theta-testnet): MsgDelegate transactions
 * - Sui (testnet): request_add_stake events
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  formatEther,
  parseUnits,
  type Address,
  type Log,
} from "viem";
import { polygonAmoy } from "viem/chains";
import { config } from "./config.js";
import { canton, TEMPLATES, type ActiveContract } from "./canton.js";
import { prisma } from "./db.js";

// === Shared types ===

interface ChainWatcher {
  start(): void;
  stop(): void;
}

interface StakingEvent {
  evmAddress: string;
  amount: bigint;
  txHash: string;
  blockNumber: number;
  chain: string;
}

// === Polygon Amoy (MockValidatorShare) ===

const polygonClient = createPublicClient({
  chain: polygonAmoy,
  transport: http(config.amoyRpcUrl),
});

const shareMintedAbi = parseAbiItem(
  "event ShareMinted(address indexed user, uint256 amount, uint256 tokens)"
);

async function watchPolygon(): Promise<void> {
  const EVENT_POLL_MS = 5_000;
  const INITIAL_LOOKBACK_BLOCKS = 50n;
  const MAX_BLOCK_RANGE = 50n;
  let lastScannedBlock: bigint | undefined;

  const poll = async () => {
    try {
      const latestBlock = await polygonClient.getBlockNumber();
      const fromBlock =
        lastScannedBlock === undefined
          ? latestBlock > INITIAL_LOOKBACK_BLOCKS
            ? latestBlock - INITIAL_LOOKBACK_BLOCKS
            : 0n
          : lastScannedBlock + 1n;
      if (fromBlock > latestBlock) return;

      const logs = await polygonClient.getLogs({
        address: config.mockValidatorShare as Address,
        event: shareMintedAbi,
        fromBlock,
        toBlock: latestBlock,
      });

      for (const log of logs) {
        await handleStakeEvent({
          evmAddress: (log as unknown as { args: { user: Address } }).args.user,
          amount: (log as unknown as { args: { amount: bigint } }).args.amount,
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          chain: "polygon",
        });
      }

      lastScannedBlock = latestBlock;
    } catch (err) {
      console.error("[polygon-watcher]", err);
    }
  };

  await poll();
  return new Promise(() => {
    const interval = setInterval(() => void poll(), EVENT_POLL_MS);
    return () => clearInterval(interval);
  });
}

// === Moonbeam (Moonbase Alpha ParachainStaking) ===

const moonbeamClient = createPublicClient({
  chain: {
    id: 1287,
    name: "Moonbase Alpha",
    nativeCurrency: { name: "GLMR", symbol: "GLMR", decimals: 18 },
    rpcUrls: {
      default: { http: [config.moonbeamRpcUrl] },
    },
  },
  transport: http(config.moonbeamRpcUrl),
});

// Moonbeam ParachainStaking precompile events
const delegatedAbi = parseAbiItem(
  "event Delegated(address indexed delegator, address indexed candidate, uint256 amount)"
);

const PARACHAIN_STAKING_PRECOMPILE: Address = "0x0000000000000000000000000000000000000800" as Address;

async function watchMoonbeam(): Promise<void> {
  const EVENT_POLL_MS = 5_000;
  const INITIAL_LOOKBACK_BLOCKS = 50n;
  const MAX_BLOCK_RANGE = 50n;
  let lastScannedBlock: bigint | undefined;

  const poll = async () => {
    try {
      const latestBlock = await moonbeamClient.getBlockNumber();
      const fromBlock =
        lastScannedBlock === undefined
          ? latestBlock > INITIAL_LOOKBACK_BLOCKS
            ? latestBlock - INITIAL_LOOKBACK_BLOCKS
            : 0n
          : lastScannedBlock + 1n;
      if (fromBlock > latestBlock) return;

      const logs = await moonbeamClient.getLogs({
        address: PARACHAIN_STAKING_PRECOMPILE,
        event: delegatedAbi,
        fromBlock,
        toBlock: latestBlock,
      });

      for (const log of logs) {
        await handleStakeEvent({
          evmAddress: (log as unknown as { args: { delegator: Address } }).args.delegator,
          amount: (log as unknown as { args: { amount: bigint } }).args.amount,
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          chain: "moonbeam",
        });
      }

      lastScannedBlock = latestBlock;
    } catch (err) {
      console.error("[moonbeam-watcher]", err);
    }
  };

  await poll();
  return new Promise(() => {
    const interval = setInterval(() => void poll(), EVENT_POLL_MS);
    return () => clearInterval(interval);
  });
}

// === Monad (Testnet Staking) ===

const monadClient = createPublicClient({
  chain: {
    id: 10143,
    name: "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: {
      default: { http: [config.monadRpcUrl] },
    },
  },
  transport: http(config.monadRpcUrl),
});

// Monad staking precompile events
const monadDelegateAbi = parseAbiItem(
  "event Delegate(address indexed delegator, uint64 validatorId, uint256 amount)"
);

const MONAD_STAKING_PRECOMPILE: Address = "0x0000000000000000000000000000000000001000" as Address;

async function watchMonad(): Promise<void> {
  const EVENT_POLL_MS = 5_000;
  const INITIAL_LOOKBACK_BLOCKS = 50n;
  const MAX_BLOCK_RANGE = 50n;
  let lastScannedBlock: bigint | undefined;

  const poll = async () => {
    try {
      const latestBlock = await monadClient.getBlockNumber();
      const fromBlock =
        lastScannedBlock === undefined
          ? latestBlock > INITIAL_LOOKBACK_BLOCKS
            ? latestBlock - INITIAL_LOOKBACK_BLOCKS
            : 0n
          : lastScannedBlock + 1n;
      if (fromBlock > latestBlock) return;

      const logs = await monadClient.getLogs({
        address: MONAD_STAKING_PRECOMPILE,
        event: monadDelegateAbi,
        fromBlock,
        toBlock: latestBlock,
      });

      for (const log of logs) {
        await handleStakeEvent({
          evmAddress: (log as unknown as { args: { delegator: Address } }).args.delegator,
          amount: (log as unknown as { args: { amount: bigint } }).args.amount,
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          chain: "monad",
        });
      }

      lastScannedBlock = latestBlock;
    } catch (err) {
      console.error("[monad-watcher]", err);
    }
  };

  await poll();
  return new Promise(() => {
    const interval = setInterval(() => void poll(), EVENT_POLL_MS);
    return () => clearInterval(interval);
  });
}

// === Cosmos (theta-testnet) ===

// Cosmos uses Tendermint RPC to search for delegate transactions
async function watchCosmos(): Promise<void> {
  const POLL_MS = 10_000;
  let lastCheckedHeight = 0;

  const poll = async () => {
    try {
      const res = await fetch(config.cosmosRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tx_search",
          params: {
            query: "message.action='delegate'",
            per_page: "50",
          },
        }),
      });
      if (!res.ok) {
        console.warn("[cosmos-watcher] RPC error:", res.status);
        return;
      }

      const body = (await res.json()) as {
        result?: {
          txs?: Array<{
            height: string;
            hash: string;
            tx_result?: {
              data?: string;
              log?: string;
            };
            tx?: string;
          }>;
          total_count: string;
        };
      };

      const txs = body.result?.txs || [];
      for (const tx of txs) {
        const height = Number(tx.height);
        if (height <= lastCheckedHeight) continue;

        // Parse the base64-encoded tx to extract the delegator address and amount
        // For now, we'll use the tx hash and let the Canton Accept handle the details
        // In production, you'd decode the protobuf tx to get the actual values

        // For the testnet demo, we'll log and continue - the actual matching
        // happens via the force-accept endpoint or by looking up pending requests
        console.log(
          `[cosmos-watcher] delegate tx at height ${height}: ${tx.hash.slice(0, 10)}...`
        );

        lastCheckedHeight = height;
      }
    } catch (err) {
      console.error("[cosmos-watcher]", err);
    }
  };

  await poll();
  return new Promise(() => {
    const interval = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(interval);
  });
}

// === Sui (testnet) ===

async function watchSui(): Promise<void> {
  const POLL_MS = 10_000;
  let lastCheckedCursor: string | null = null;

  const poll = async () => {
    try {
      // Query for StakeRequest events (request_add_stake)
      const res = await fetch(`${config.suiRpcUrl}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "suix_queryEvents",
          params: [
            {
              query: { MoveEventType: "0x3::sui_system::StakeRequest" },
              limit: 50,
              cursor: lastCheckedCursor || undefined,
            },
          ],
        }),
      });

      if (!res.ok) {
        console.warn("[sui-watcher] RPC error:", res.status);
        return;
      }

      const body = (await res.json()) as {
        result?: {
          data?: Array<{
            id: { txDigest: string };
            parsedJson?: {
              delegator: string;
              amount: string;
            };
            timestampMs: string;
          }>;
          hasNextPage: boolean;
          nextCursor: string;
        };
      };

      const events = body.result?.data || [];
      for (const ev of events) {
        if (!ev.parsedJson) continue;

        // Sui amount is in MIST (10^-9), convert to bigint
        const amount = BigInt(ev.parsedJson.amount);
        const evmAddress = ev.parsedJson.delegator; // Sui address

        await handleStakeEvent({
          evmAddress,
          amount,
          txHash: ev.id.txDigest,
          blockNumber: Math.floor(Number(ev.timestampMs) / 1000),
          chain: "sui",
        });
      }

      if (body.result?.hasNextPage) {
        lastCheckedCursor = body.result.nextCursor;
      }
    } catch (err) {
      console.error("[sui-watcher]", err);
    }
  };

  await poll();
  return new Promise(() => {
    const interval = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(interval);
  });
}

// === Shared matching and handling logic ===

function normalizeDecimal(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isFinite(n)) return undefined;
  return n.toFixed(12).replace(/\.?0+$/, "");
}

async function findPendingRequest(
  evmAddress: string,
  amount: bigint,
  chain: string
): Promise<ActiveContract | undefined> {
  const requests = await canton.activeContracts(TEMPLATES.StakingRequest);
  const normalizedAddress = evmAddress.toLowerCase();

  // For EVM chains, match by address and amount
  // For Cosmos/Sui, we need special handling since addresses are different formats
  const amountDecimal = normalizeDecimal(formatEther(amount));

  return requests.find((r) => {
    const arg = r.argument as {
      evmAddress?: string;
      amountPol?: string | number;
      chain?: string;
    };

    // Match chain if specified in the request
    if (arg.chain && arg.chain !== chain) return false;

    // For Cosmos/Sui, the evmAddress is stored as-is (bech32 or Sui address)
    const requestAddress = arg.evmAddress?.toLowerCase() || "";
    const matchesAddress = requestAddress === normalizedAddress ||
                         requestAddress === evmAddress;

    return matchesAddress && normalizeDecimal(arg.amountPol) === amountDecimal;
  });
}

async function handleStakeEvent(event: StakingEvent): Promise<void> {
  console.log(
    `[${event.chain}-watcher] stake from ${event.evmAddress.slice(0, 10)}... amount=${formatEther(event.amount)} tx=${event.txHash}`
  );

  const req = await findPendingRequest(event.evmAddress, event.amount, event.chain);
  if (!req) {
    console.warn(
      `  no matching pending StakingRequest for ${event.evmAddress.slice(0, 10)}... / ${formatEther(event.amount)}`
    );
    return;
  }

  try {
    const result = await canton.exerciseChoice({
      templateId: TEMPLATES.StakingRequest,
      contractId: req.contractId,
      choice: "StakingRequest_Accept",
      argument: {
        proof: {
          txHash: event.txHash,
          blockNumber: event.blockNumber,
          validatorShare:
            event.chain === "polygon"
              ? config.mockValidatorShare
              : `${event.chain}::precompile`,
        },
        featuredRightCid: null,
      },
    });
    console.log(`  -> accepted. tx=${result.transactionId}`);

    // Mirror to Postgres
    const reqArg = req.argument as {
      evmAddress?: string;
      amountPol?: string;
      delegator?: string;
    };

    // Extract the new StakingPosition contractId from the Accept result
    let newPositionCid = `pending-${Date.now()}`;
    for (const ev of result.events || []) {
      const event = ev as Record<string, unknown>;
      const created = event.CreatedEvent as Record<string, unknown> | undefined;
      if (created?.contractId) {
        newPositionCid = created.contractId as string;
        break;
      }
    }

    await prisma.stakingPosition.upsert({
      where: { contractId: newPositionCid },
      update: {
        status: "Bonded",
        evmTxHash: event.txHash,
        cantonTxId: result.transactionId,
      },
      create: {
        contractId: newPositionCid,
        userId: (await prisma.user.findFirst({
          where: { evmAddress: event.evmAddress.toLowerCase() },
        }))?.id || "",
        evmAddress: event.evmAddress.toLowerCase(),
        amountPol: reqArg.amountPol || formatEther(event.amount),
        status: "Bonded",
        evmTxHash: event.txHash,
        cantonTxId: result.transactionId,
      },
    });
    console.log(`  -> mirrored Bonded position to Postgres`);
  } catch (err) {
    console.error(`  failed to accept StakingRequest:`, err);
  }
}

// === Start all watchers ===

const activeWatchers: Array<() => Promise<void>> = [];

export function startMultichainWatchers(): void {
  console.log("[orchestrator] starting multichain event watchers...");

  // Start each chain watcher
  activeWatchers.push(watchPolygon);
  activeWatchers.push(watchMoonbeam);
  activeWatchers.push(watchMonad);
  activeWatchers.push(watchCosmos);
  activeWatchers.push(watchSui);

  // Fire and forget - each watcher starts its own polling loop
  for (const watcher of activeWatchers) {
    watcher().catch((err) => console.error("watcher failed:", err));
  }

  console.log(`[orchestrator] ${activeWatchers.length} chain watchers started`);
}

// Backwards-compatible export for the existing orchestrator.ts
export { findPendingRequest };
