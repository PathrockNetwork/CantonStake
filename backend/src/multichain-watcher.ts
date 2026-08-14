/**
 * Multichain event watchers: polls each chain's staking events and
 * translates them into Canton Daml choices.
 *
 * Supported chains:
 * - Polygon PoS: StakingInfo ShareMinted / ShareBurnedWithId events on
 *   Ethereum L1 (Sepolia for Amoy) — one ValidatorShare per validator,
 *   resolved per event. NOT the Bor chain, and not a single global contract.
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
import { fromBase64 } from "@cosmjs/encoding";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { MsgDelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx";
import { config } from "./config.js";
import { canton, TEMPLATES, type ActiveContract } from "./canton.js";
import { prisma } from "./db.js";
import { handlePolygonUnbondEvent, featuredRightCidForDaml } from "./orchestrator.js";
import {
  settlementClient,
  shareForValidatorId,
  stakingLoggerAbi,
  stakingLoggerAddress,
} from "./services/validator-share.js";

// === Shared types ===

interface ChainWatcher {
  start(): void;
  stop(): void;
}

interface StakingEvent {
  evmAddress: string;
  /**
   * Base-unit amount scaled to 18 decimals, so the shared matcher's
   * formatEther() yields the human-readable stake for every chain
   * (uatom=6, MIST=9, native EVM wei=18). Use toStakeUnits() below.
   */
  amount: bigint;
  txHash: string;
  blockNumber: number;
  chain: string;
  /**
   * The real identifier of the on-chain staking module / contract that
   * custody this stake: Polygon → the per-validator ValidatorShare
   * (resolved from the event's validatorId); Moonbeam/Monad → the
   * staking precompile; Sui → the system staking object; Cosmos → the
   * validator operator address from the decoded MsgDelegate. Never a
   * fabricated placeholder.
   */
  validatorShare: string;
  validatorId?: number;
  /** Shares minted — not equal to `amount`; see exchangeRate math. */
  shares?: bigint;
}

/** Scale a base-unit amount with `decimals` decimals into 18-decimal units. */
function toStakeUnits(amount: bigint, decimals: number): bigint {
  if (decimals === 18) return amount;
  if (decimals > 18) return amount / 10n ** BigInt(decimals - 18);
  return amount * 10n ** BigInt(18 - decimals);
}

// === Polygon PoS (real ValidatorShare, settled on Ethereum L1) ===
//
// Polygon PoS staking does NOT settle on Bor/Amoy. The delegation events we
// need are emitted by the shared StakingInfo logger on Ethereum L1 (Sepolia
// for Amoy) and carry the validatorId as their first indexed topic — the
// ValidatorShare contracts themselves emit nothing. So we watch ONE logger
// address and resolve the per-validator ValidatorShare from the validatorId
// on each event. See services/validator-share.ts for the verified facts.

async function watchPolygon(): Promise<void> {
  const POLL_MS = config.polygonWatcherPollMs;
  const INITIAL_LOOKBACK_BLOCKS = BigInt(config.polygonWatcherLookbackBlocks);
  const MAX_BLOCK_RANGE = BigInt(config.polygonWatcherMaxRange);
  let lastScannedBlock: bigint | undefined;

  console.log(
    `[polygon-watcher] watching StakingInfo ${stakingLoggerAddress} on chain ` +
      `${config.stakeSettlementChainId} (${config.stakeSettlementRpcUrl})`
  );

  const getLogsBatched = async (
    eventName: "ShareMinted" | "ShareBurnedWithId",
    fromBlock: bigint,
    toBlock: bigint
  ) => {
    const out: unknown[] = [];
    for (let from = fromBlock; from <= toBlock; from += MAX_BLOCK_RANGE + 1n) {
      const to = from + MAX_BLOCK_RANGE > toBlock ? toBlock : from + MAX_BLOCK_RANGE;
      const logs = await settlementClient.getContractEvents({
        address: stakingLoggerAddress,
        abi: stakingLoggerAbi,
        eventName,
        fromBlock: from,
        toBlock: to,
      });
      out.push(...logs);
    }
    return out;
  };

  const poll = async () => {
    try {
      const latestBlock = await settlementClient.getBlockNumber();
      const fromBlock =
        lastScannedBlock === undefined
          ? latestBlock > INITIAL_LOOKBACK_BLOCKS
            ? latestBlock - INITIAL_LOOKBACK_BLOCKS
            : 0n
          : lastScannedBlock + 1n;
      if (fromBlock > latestBlock) return;

      const [minted, burned] = await Promise.all([
        getLogsBatched("ShareMinted", fromBlock, latestBlock),
        getLogsBatched("ShareBurnedWithId", fromBlock, latestBlock),
      ]);

      for (const raw of minted) {
        const log = raw as {
          args: { validatorId?: bigint; user?: Address; amount?: bigint; tokens?: bigint };
          transactionHash: string;
          blockNumber: bigint;
        };
        const { validatorId, user, amount, tokens } = log.args;
        if (validatorId === undefined || user === undefined || amount === undefined) {
          continue;
        }
        const share = await shareForValidatorId(validatorId);
        if (!share) {
          console.warn(
            `[polygon-watcher] no ValidatorShare for validatorId ${validatorId}; skipping`
          );
          continue;
        }
        await handleStakeEvent({
          evmAddress: user,
          amount,
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          chain: "polygon",
          validatorShare: share,
          validatorId: Number(validatorId),
          shares: tokens,
        });
      }

      for (const raw of burned) {
        const log = raw as {
          args: {
            validatorId?: bigint;
            user?: Address;
            amount?: bigint;
            tokens?: bigint;
            nonce?: bigint;
          };
          transactionHash: string;
          blockNumber: bigint;
        };
        const { validatorId, user, amount, tokens, nonce } = log.args;
        if (
          validatorId === undefined ||
          user === undefined ||
          amount === undefined ||
          nonce === undefined
        ) {
          continue;
        }
        const share = await shareForValidatorId(validatorId);
        if (!share) {
          console.warn(
            `[polygon-watcher] no ValidatorShare for validatorId ${validatorId}; skipping unbond`
          );
          continue;
        }
        await handlePolygonUnbondEvent({
          user,
          amount,
          shares: tokens ?? 0n,
          nonce,
          validatorId: Number(validatorId),
          validatorShare: share,
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
        });
      }

      lastScannedBlock = latestBlock;
    } catch (err) {
      console.error("[polygon-watcher]", err);
    }
  };

  await poll();
  return new Promise(() => {
    const interval = setInterval(() => void poll(), POLL_MS);
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
          // Moonbase Alpha ParachainStaking precompile — the single
          // contract custody all delegations on Moonbeam.
          validatorShare: PARACHAIN_STAKING_PRECOMPILE,
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
        const args = (log as unknown as { args: { delegator: Address; amount: bigint; validatorId: bigint } }).args;
        await handleStakeEvent({
          evmAddress: args.delegator,
          amount: args.amount,
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
          chain: "monad",
          // Monad Testnet staking precompile — the single contract
          // custody all delegations on Monad.
          validatorShare: MONAD_STAKING_PRECOMPILE,
          validatorId: args.validatorId !== undefined ? Number(args.validatorId) : undefined,
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

// Cosmos uses Tendermint RPC to search for delegate transactions.
// Each matching tx is decoded from protobuf (TxRaw → TxBody → MsgDelegate)
// to extract the REAL delegator address, validator operator address and
// amount — a fabricated hash or an undecodable tx can never produce a
// bonded position here.
async function watchCosmos(): Promise<void> {
  const POLL_MS = 10_000;
  // Height-windowed polling: each query only fetches delegate txs strictly
  // above the last processed height, so the seen-set is a dedup safety net
  // (capped), not the primary mechanism.
  const SEEN_CAP = 2000;
  const seenTxHashes = new Set<string>();
  const seenOrder: string[] = [];
  let lastCheckedHeight = 0;

  const poll = async () => {
    try {
      // The Tendermint index keys message.action by the FULL typeURL —
      // the short form 'delegate' matches nothing (verified against
      // theta-testnet: 0 hits vs ~100k for the full path).
      const query =
        lastCheckedHeight > 0
          ? `message.action='/cosmos.staking.v1beta1.MsgDelegate' AND height>${lastCheckedHeight}`
          : "message.action='/cosmos.staking.v1beta1.MsgDelegate'";
      const res = await fetch(config.cosmosRpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tx_search",
          params: {
            query,
            per_page: "50",
            order_by: "desc",
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
              code?: number;
              data?: string;
              log?: string;
            };
            tx?: string;
          }>;
          total_count: string;
        };
      };
      if ((body as { error?: { message?: string } }).error) {
        console.warn(
          "[cosmos-watcher] tx_search error:",
          (body as { error: { message?: string } }).error.message
        );
        return;
      }

      const txs = body.result?.txs || [];
      for (const tx of txs) {
        const height = Number(tx.height);
        if (height > lastCheckedHeight) lastCheckedHeight = height;
        if (seenTxHashes.has(tx.hash)) continue;
        seenTxHashes.add(tx.hash);
        seenOrder.push(tx.hash);
        if (seenOrder.length > SEEN_CAP) {
          const drop = seenOrder.shift();
          if (drop) seenTxHashes.delete(drop);
        }

        // Only successful transactions carry a settled delegation.
        if (tx.tx_result?.code !== undefined && tx.tx_result.code !== 0) {
          continue;
        }
        if (!tx.tx) continue;

        try {
          const txRaw = decodeTxRaw(fromBase64(tx.tx));
          for (const message of txRaw.body.messages) {
            if (message.typeUrl !== "/cosmos.staking.v1beta1.MsgDelegate") {
              continue;
            }
            const msg = MsgDelegate.decode(message.value);
            // uatom has 6 decimals — scale to 18-decimal stake units so
            // the shared matcher's formatEther() yields ATOM.
            const denomDecimals = msg.amount?.denom.startsWith("u") ? 6 : 18;
            const amount = toStakeUnits(
              BigInt(msg.amount?.amount ?? "0"),
              denomDecimals
            );
            if (amount === 0n) continue;

            console.log(
              `[cosmos-watcher] delegate ${msg.amount?.amount} ${msg.amount?.denom} ` +
                `from ${msg.delegatorAddress} to ${msg.validatorAddress} at height ${height}`
            );

            await handleStakeEvent({
              evmAddress: msg.delegatorAddress,
              amount,
              txHash: tx.hash.toUpperCase(),
              blockNumber: height,
              chain: "cosmos",
              // The validator's operator address — Cosmos's per-validator
              // staking identifier.
              validatorShare: msg.validatorAddress,
            });
          }
        } catch (decodeErr) {
          console.warn(
            `[cosmos-watcher] failed to decode tx ${tx.hash.slice(0, 10)}...:`,
            decodeErr instanceof Error ? decodeErr.message : decodeErr
          );
        }
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
            sender?: string;
            parsedJson?: {
              pool_id?: string;
              stake_amount?: string;
            };
            timestampMs: string;
          }>;
          hasNextPage: boolean;
          nextCursor: string;
        };
        error?: { code?: number; message?: string };
      };

      // Public fullnodes deprecated JSON-RPC (2026): an HTTP 200 carrying
      // an error object means this watcher sees NOTHING — fail loudly
      // instead of silently reporting an empty chain.
      if (body.error) {
        console.error(
          `[sui-watcher] RPC rejected the call (${body.error.code}): ` +
            `${body.error.message ?? "unknown error"} — Sui events are NOT ` +
            `being watched. Migrate SUI_RPC_URL to a GraphQL-capable endpoint.`
        );
        return;
      }

      const events = body.result?.data || [];
      for (const ev of events) {
        // 0x3::sui_system::StakeRequest fields: pool_id (the validator's
        // staking pool object) and stake_amount (MIST). The delegator is
        // the transaction sender.
        const staker = ev.sender;
        const poolId = ev.parsedJson?.pool_id;
        const stakeAmount = ev.parsedJson?.stake_amount;
        if (!staker || !poolId || !stakeAmount) {
          console.warn(
            `[sui-watcher] StakeRequest without pool_id/stake_amount/sender: ${ev.id.txDigest}`
          );
          continue;
        }

        // MIST is 10^-9 SUI — scale to the 18-decimal stake units the
        // shared matcher normalises with formatEther().
        const amount = toStakeUnits(BigInt(stakeAmount), 9);

        await handleStakeEvent({
          evmAddress: staker,
          amount,
          txHash: ev.id.txDigest,
          blockNumber: Math.floor(Number(ev.timestampMs) / 1000),
          chain: "sui",
          // The validator's own staking pool object on Sui.
          validatorShare: poolId,
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
          // The real staking module that custody this stake — per-chain
          // identifiers set where each watcher decodes its event. Never
          // a placeholder (see docs/PROOF_TRUST_MODEL.md).
          validatorShare: event.validatorShare,
        },
        featuredRightCid: featuredRightCidForDaml(),
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

    // Per-validator staking metadata. Every downstream read (reward sweep,
    // unbond claimability, portfolio) needs to know WHICH ValidatorShare this
    // position lives on, because there is no global one.
    const validatorFields = {
      chain: event.chain,
      ...(event.validatorShare ? { validatorShare: event.validatorShare } : {}),
      ...(event.validatorId !== undefined ? { validatorId: event.validatorId } : {}),
      ...(event.shares !== undefined ? { amountShares: event.shares.toString() } : {}),
    };

    await prisma.stakingPosition.upsert({
      where: { contractId: newPositionCid },
      update: {
        status: "Bonded",
        evmTxHash: event.txHash,
        cantonTxId: result.transactionId,
        ...validatorFields,
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
        ...validatorFields,
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
