/**
 * Multichain event watchers: polls each chain's staking events and
 * translates them into Canton Daml choices.
 *
 * Supported chains:
 * - Polygon PoS: StakingInfo ShareMinted / ShareBurnedWithId events on
 *   Ethereum L1 (Sepolia for Amoy) — one ValidatorShare per validator,
 *   resolved per event. NOT the Bor chain, and not a single global contract.
 * - Monad (Testnet): Staking Delegate events
 * - Cosmos-shape (Cosmos Hub, Celestia mocha, Osmosis testnet):
 *   MsgDelegate transactions via Tendermint tx_search + protobuf decode
 * - Sui (testnet): request_add_stake events (needs a GraphQL-capable RPC;
 *   public fullnodes deprecated JSON-RPC)
 * - Aptos (testnet): 0x1::stake::AddStakeEvent via REST transactions
 * - Polkadot (Westend): nominationPools.Bonded / staking.Bonded block events
 * - BNB Chain (Chapel): StakeHub Delegated logs
 * - Solana (testnet): Stake Program delegateStake instructions
 */

import {
  createPublicClient,
  http,
  parseAbiItem,
  formatEther,
  parseUnits,
  toHex,
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
   * (resolved from the event's validatorId); Monad → the staking
   * precompile; Sui → the system staking object; Cosmos → the
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
      reportWatcherOk("polygon");
    } catch (err) {
      console.error("[polygon-watcher]", err);
      reportWatcherError("polygon", err);
      // Free-tier RPCs reject getLogs windows too far behind head as
      // "archive". If the cursor has fallen more than a lookback behind,
      // retrying that window can never succeed — drop it and re-anchor at
      // head − lookback on the next poll (events in the gap are skipped)
      // rather than wedging the watcher in archive territory.
      if (lastScannedBlock !== undefined) {
        try {
          const head = await settlementClient.getBlockNumber();
          if (head - lastScannedBlock > INITIAL_LOOKBACK_BLOCKS * 2n) {
            console.warn(
              `[polygon-watcher] cursor ${lastScannedBlock} is ` +
                `${head - lastScannedBlock} blocks behind head ${head}; re-anchoring`
            );
            lastScannedBlock = undefined;
          }
        } catch {
          /* head probe failed too; retry the window next poll */
        }
      }
    }
  };

  await poll();
  return new Promise(() => {
    const interval = setInterval(() => void poll(), POLL_MS);
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
      reportWatcherOk("monad");
    } catch (err) {
      console.error("[monad-watcher]", err);
      reportWatcherError("monad", err);
    }
  };

  await poll();
  return new Promise(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await poll();
      const failures = watcherHealth.get("monad")?.consecutiveFailures ?? 0;
      setTimeout(() => void tick(), backoffDelayMs(failures, EVENT_POLL_MS));
    };
    void tick();
    return () => {
      stopped = true;
    };
  });
}

// === Aptos (testnet, Move) ================================================
//
// Aptos staking = one stake pool per validator, owned by an account; users
// add stake to a pool via 0x1::stake::add_stake. Events land in the
// transaction's events array (type 0x1::stake::AddStakeEvent) with the
// pool address in the event guid. The fullnode REST API serves
// transactions by ledger version, so the watcher walks the version range:
// every event we accept comes from a settled, indexed transaction.

interface AptosTx {
  type?: string;
  version: string;
  hash: string;
  sender?: string;
  success?: boolean;
  events?: Array<{
    type?: string;
    guid?: { account_address?: string };
    data?: { amount?: string | number };
  }>;
}

const APTOS_ADD_STAKE_EVENT = "0x1::stake::AddStakeEvent";

async function watchAptos(): Promise<void> {
  const POLL_MS = 12_000;
  const PAGE = 50;
  const base = config.aptosRestUrl.replace(/\/$/, "");
  let lastVersion: bigint | undefined;

  // Seed the cursor from the current ledger tip.
  try {
    const res = await fetch(`${base}/v1`);
    if (res.ok) {
      const info = (await res.json()) as { ledger_version?: string };
      if (info.ledger_version) lastVersion = BigInt(info.ledger_version);
    }
  } catch (err) {
    console.warn("[aptos-watcher] ledger info fetch failed:", err);
  }

  const poll = async () => {
    if (lastVersion === undefined) return;
    const from = lastVersion + 1n;
    const res = await fetch(`${base}/v1/transactions?start=${from}&limit=${PAGE}`);
    if (!res.ok) {
      throw new Error(`transactions?start=${from} returned ${res.status}`);
    }
    const txs = (await res.json()) as AptosTx[];
    if (!Array.isArray(txs)) return;

    for (const tx of txs) {
      if (tx.version) {
        const v = BigInt(tx.version);
        if (v > lastVersion!) lastVersion = v;
      }
      if (tx.success === false) continue;
      if (!tx.sender) continue;

      for (const ev of tx.events ?? []) {
        if (ev.type !== APTOS_ADD_STAKE_EVENT) continue;
        const amountOcta = BigInt(ev.data?.amount ?? "0");
        if (amountOcta === 0n) continue;
        const pool = ev.guid?.account_address;
        if (!pool) continue;

        // Octa = 10^-8 APT — scale to the shared 18-decimal stake units.
        const amount = toStakeUnits(amountOcta, 8);

        await handleStakeEvent({
          evmAddress: tx.sender,
          amount,
          txHash: tx.hash,
          blockNumber: Number(BigInt(tx.version)),
          chain: "aptos",
          // The staking pool address identifies the validator on Aptos.
          validatorShare: pool,
        });
      }
    }
    reportWatcherOk("aptos");
  };

  await poll();
  return new Promise(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        await poll();
      } catch (err) {
        console.error("[aptos-watcher]", err);
        reportWatcherError("aptos", err);
      }
      const failures = watcherHealth.get("aptos")?.consecutiveFailures ?? 0;
      setTimeout(() => void tick(), backoffDelayMs(failures, POLL_MS));
    };
    void tick();
    return () => {
      stopped = true;
    };
  });
}

// === Solana (testnet, account model) ======================================
//
// Solana has no event logs: delegation is an instruction to the Stake
// Program (DelegateStake) that mutates a stake account. The watcher polls
// getSignaturesForAddress on the Stake Program, then fetches each new
// transaction in jsonParsed form and reads the parsed delegateStake
// instructions — stake account, vote account (= the validator) and the
// post-tx stake-account balance (= the delegated amount). Everything is
// derived from settled transactions, same trust model as the other
// watchers (docs/PROOF_TRUST_MODEL.md).

const SOLANA_STAKE_PROGRAM = "Stake11111111111111111111111111111111111111";

interface SolanaParsedInstruction {
  programId?: string;
  parsed?: {
    type?: string;
    info?: {
      stakeAccount?: string;
      voteAccount?: string;
    };
  };
}

async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  const res = await fetch(config.solanaRpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!res.ok) {
    throw new Error(`${method} returned ${res.status}`);
  }
  const body = (await res.json()) as { result?: T; error?: { message?: string } };
  if (body.error) {
    throw new Error(`${method}: ${body.error.message ?? "rpc error"}`);
  }
  return body.result as T;
}

async function watchSolana(): Promise<void> {
  const POLL_MS = 15_000;
  const BATCH = 20;
  const seenSignatures = new Set<string>();
  const seenOrder: string[] = [];
  const SEEN_CAP = 2000;

  const poll = async () => {
    const sigs = await solanaRpc<Array<{ signature: string; err: unknown } | null>>(
      "getSignaturesForAddress",
      [SOLANA_STAKE_PROGRAM, { limit: BATCH }]
    );
    if (!Array.isArray(sigs)) return;

    // getSignaturesForAddress returns newest-first; only process unseen.
    const fresh = sigs
      .filter((s): s is { signature: string; err: unknown } => s !== null)
      .filter((s) => !seenSignatures.has(s.signature))
      .reverse(); // oldest → newest so ledger order is preserved

    for (const sig of fresh) {
      seenSignatures.add(sig.signature);
      seenOrder.push(sig.signature);
      if (seenOrder.length > SEEN_CAP) {
        const drop = seenOrder.shift();
        if (drop) seenSignatures.delete(drop);
      }
      if (sig.err) continue; // failed tx settles nothing

      const tx = await solanaRpc<{
        transaction?: {
          message?: {
            instructions?: SolanaParsedInstruction[];
            accountKeys?: Array<string | { pubkey: string }>;
          };
        };
        meta?: { postBalances?: number[] };
      } | null>("getTransaction", [
        sig.signature,
        { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 },
      ]);
      if (!tx?.transaction?.message || !tx.meta?.postBalances) continue;

      const keys = (tx.transaction.message.accountKeys ?? []).map((k) =>
        typeof k === "string" ? k : k.pubkey
      );
      for (const ix of tx.transaction.message.instructions ?? []) {
        if (ix.programId !== SOLANA_STAKE_PROGRAM) continue;
        if (ix.parsed?.type !== "delegateStake") continue;

        const stakeAccount = ix.parsed.info?.stakeAccount;
        const voteAccount = ix.parsed.info?.voteAccount;
        if (!stakeAccount || !voteAccount) continue;

        // Delegated amount = the stake account's post-tx lamports.
        const idx = keys.indexOf(stakeAccount);
        if (idx < 0) continue;
        const lamports = tx.meta.postBalances[idx] ?? 0;
        if (lamports <= 0) continue;

        await handleStakeEvent({
          evmAddress: stakeAccount, // stake account is the Solana identity here
          amount: toStakeUnits(BigInt(lamports), 9),
          txHash: sig.signature,
          blockNumber: 0,
          chain: "solana",
          // The vote account IS the validator on Solana.
          validatorShare: voteAccount,
        });
      }
    }
    reportWatcherOk("solana");
  };

  await poll();
  return new Promise(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        await poll();
      } catch (err) {
        console.error("[solana-watcher]", err);
        reportWatcherError("solana", err);
      }
      const failures = watcherHealth.get("solana")?.consecutiveFailures ?? 0;
      setTimeout(() => void tick(), backoffDelayMs(failures, POLL_MS));
    };
    void tick();
    return () => {
      stopped = true;
    };
  });
}

// === Polkadot / Westend (Substrate) =======================================
//
// Polkadot delegation = nomination pools (min 1 DOT on mainnet, 0.01 WND
// equivalents on Westend): a member bonds into a pool, the pool nominates
// validators. Settlement is observable in the block event stream:
//   nominationPools.Bonded { member, poolId, bonded, free }
//   staking.Bonded        { stash, controller, amount }   (direct nominators)
// SCALE decoding needs the runtime metadata, hence @polkadot/api. The
// connection is HTTPS JSON-RPC (no WebSocket), polling finalized heads.

async function watchPolkadot(): Promise<void> {
  const POLL_MS = 15_000;
  const { ApiPromise, HttpProvider } = await import("@polkadot/api");
  const provider = new HttpProvider(config.polkadotRpcUrl);
  const api = await ApiPromise.create({ provider, noInitWarn: true });
  await api.isReady;
  console.log(`[polkadot-watcher] connected to ${config.polkadotRpcUrl}`);

  let lastProcessed: number | undefined;

  const poll = async () => {
    const head = await api.rpc.chain.getFinalizedHead();
    const header = await api.rpc.chain.getHeader(head);
    const number = header.number.toNumber();
    if (lastProcessed === undefined) {
      // Start from the current finalized tip — replaying history would
      // re-settle ancient bonds into stale Canton requests.
      lastProcessed = number;
      return;
    }
    if (number <= lastProcessed) return;

    for (let n = lastProcessed + 1; n <= number; n++) {
      const hash = await api.rpc.chain.getBlockHash(n);
      const at = await api.at(hash);

      // The runtime-augmented EventRecord typing isn't available without
      // codegen; the shape is stable across Substrate runtimes.
      const records = (await at.query.system.events()) as unknown as Array<{
        event: { section: string; method: string; data: { toArray(): unknown[] } };
      }>;
      for (const { event } of records) {
        if (event.section === "nominationPools" && event.method === "Bonded") {
          // [member, poolId, bonded, free]
          const dataArr = event.data.toArray();
          const member = dataArr[0];
          const poolId = dataArr[1];
          const bonded = dataArr[2];
          const amountPlanks = BigInt(bonded?.toString() ?? "0");
          if (amountPlanks === 0n || !member) continue;

          await handleStakeEvent({
            evmAddress: member.toString(),
            // WND/DOT have 10 decimals (planks) — scale to 18 units.
            amount: toStakeUnits(amountPlanks, 10),
            txHash: hash.toHex(),
            blockNumber: n,
            chain: "polkadot",
            // Nomination pools: the pool id IS the staking identifier.
            validatorShare: `pool:${poolId?.toString() ?? "?"}`,
          });
        } else if (event.section === "staking" && event.method === "Bonded") {
          // [stash, controller, amount] — direct (non-pool) nomination.
          const dataArr = event.data.toArray();
          const stash = dataArr[0];
          const amountRaw = dataArr[2];
          const amountPlanks = BigInt(amountRaw?.toString() ?? "0");
          if (amountPlanks === 0n || !stash) continue;

          await handleStakeEvent({
            evmAddress: stash.toString(),
            amount: toStakeUnits(amountPlanks, 10),
            txHash: hash.toHex(),
            blockNumber: n,
            chain: "polkadot",
            validatorShare: "nomination",
          });
        }
      }
    }
    lastProcessed = number;
    reportWatcherOk("polkadot");
  };

  await poll();
  return new Promise(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        await poll();
      } catch (err) {
        console.error("[polkadot-watcher]", err);
        reportWatcherError("polkadot", err);
      }
      const failures = watcherHealth.get("polkadot")?.consecutiveFailures ?? 0;
      setTimeout(() => void tick(), backoffDelayMs(failures, POLL_MS));
    };
    void tick();
    return () => {
      stopped = true;
    };
  });
}

// === BNB Chain (Chapel testnet / BSC mainnet, EVM) ========================
//
// Native BNB staking settles through the StakeHub system contract
// (0x…2002, same address on testnet and mainnet). Delegation is
// `delegate(operatorAddress, delegateVotePower)` — payable — and emits
// Delegated(operatorAddress indexed, delegator indexed, shares, bnbAmount).
// Verified against a real settled mainnet delegation on 2026-08-16
// (topic0 0x24d7bda8…, data = shares ‖ bnbAmount). BNB has 18 decimals.

const BNB_STAKE_HUB = "0x0000000000000000000000000000000000002002" as Address;
const BNB_DELEGATED_TOPIC =
  "0x24d7bda8602b916d64417f0dbfe2e2e88ec9b1157bd9f596dfdb91ba26624e04";

const bnbClient = createPublicClient({
  chain: {
    id: 97,
    name: "BNB Smart Chain Chapel",
    nativeCurrency: { name: "tBNB", symbol: "tBNB", decimals: 18 },
    rpcUrls: { default: { http: [config.bnbRpcUrl] } },
  },
  transport: http(config.bnbRpcUrl),
});

async function watchBnb(): Promise<void> {
  const POLL_MS = 12_000;
  const LOOKBACK = 3000n;
  let lastScanned: bigint | undefined;

  const poll = async () => {
    const latest = await bnbClient.getBlockNumber();
    const from = lastScanned === undefined ? latest - LOOKBACK : lastScanned + 1n;
    if (from > latest) return;

    // Raw eth_getLogs (no event ABI decode — the Delegated layout is
    // unpacked manually below, verified against a settled mainnet log).
    const logs = (await bnbClient.request({
      method: "eth_getLogs",
      params: [
        {
          address: BNB_STAKE_HUB,
          topics: [BNB_DELEGATED_TOPIC],
          fromBlock: toHex(from),
          toBlock: toHex(latest),
        },
      ],
    })) as Array<{
      topics: string[];
      data: `0x${string}`;
      transactionHash: `0x${string}`;
      blockNumber: string;
    }>;

    for (const log of logs) {
      if (log.topics.length < 3) continue;
      const operator = `0x${log.topics[1]!.slice(26)}` as Address;
      const delegator = `0x${log.topics[2]!.slice(26)}` as Address;
      // data = abi.encode(shares: uint256, bnbAmount: uint256)
      const data = log.data.slice(2);
      if (data.length < 128) continue;
      const bnbAmount = BigInt(`0x${data.slice(64, 128)}`);
      const shares = BigInt(`0x${data.slice(0, 64)}`);
      if (bnbAmount === 0n) continue;

      await handleStakeEvent({
        evmAddress: delegator,
        amount: bnbAmount,
        txHash: log.transactionHash,
        blockNumber: Number(BigInt(log.blockNumber)),
        chain: "bnb",
        // The validator's operator address on BNB Chain.
        validatorShare: operator,
        shares,
      });
    }
    lastScanned = latest;
    reportWatcherOk("bnb");
  };

  await poll();
  return new Promise(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try {
        await poll();
      } catch (err) {
        console.error("[bnb-watcher]", err);
        reportWatcherError("bnb", err);
      }
      const failures = watcherHealth.get("bnb")?.consecutiveFailures ?? 0;
      setTimeout(() => void tick(), backoffDelayMs(failures, POLL_MS));
    };
    void tick();
    return () => {
      stopped = true;
    };
  });
}

// === Cosmos-shape networks (Cosmos Hub, Celestia, Osmosis) ================
//
// All Cosmos SDK chains share the same settlement surface: Tendermint
// tx_search + protobuf TxRaw → MsgDelegate decode. The watcher is
// parameterised per network below; a new Cosmos chain is a config entry,
// not new code.

interface CosmosNetwork {
  /** CantonStake chain id — keys StakingRequest.chain + watcher health. */
  chain: string;
  rpcUrl: string;
  pollMs: number;
}

const COSMOS_NETWORKS: CosmosNetwork[] = [
  {
    chain: "cosmos",
    rpcUrl: config.cosmosRpcUrl,
    pollMs: 10_000,
  },
  {
    chain: "celestia",
    rpcUrl: config.celestiaRpcUrl,
    pollMs: 10_000,
  },
  {
    chain: "osmosis",
    rpcUrl: config.osmosisRpcUrl,
    pollMs: 10_000,
  },
];

// Cosmos uses Tendermint RPC to search for delegate transactions.
// Each matching tx is decoded from protobuf (TxRaw → TxBody → MsgDelegate)
// to extract the REAL delegator address, validator operator address and
// amount — a fabricated hash or an undecodable tx can never produce a
// bonded position here.
async function watchCosmosChain(net: CosmosNetwork): Promise<void> {
  const POLL_MS = net.pollMs;
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
      const res = await fetch(net.rpcUrl, {
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
        console.warn(`[${net.chain}-watcher] RPC error:`, res.status);
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
          `[${net.chain}-watcher] tx_search error:`,
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
              `[${net.chain}-watcher] delegate ${msg.amount?.amount} ${msg.amount?.denom} ` +
                `from ${msg.delegatorAddress} to ${msg.validatorAddress} at height ${height}`
            );

            await handleStakeEvent({
              evmAddress: msg.delegatorAddress,
              amount,
              txHash: tx.hash.toUpperCase(),
              blockNumber: height,
              chain: net.chain,
              // The validator's operator address — Cosmos's per-validator
              // staking identifier.
              validatorShare: msg.validatorAddress,
            });
          }
        } catch (decodeErr) {
          console.warn(
            `[${net.chain}-watcher] failed to decode tx ${tx.hash.slice(0, 10)}...:`,
            decodeErr instanceof Error ? decodeErr.message : decodeErr
          );
        }
      }
      reportWatcherOk(net.chain);
    } catch (err) {
      console.error(`[${net.chain}-watcher]`, err);
      reportWatcherError(net.chain, err);
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
        const detail =
          `Sui RPC rejected the call (${body.error.code}): ` +
          `${body.error.message ?? "unknown error"} — ` +
          `migrate SUI_RPC_URL to a GraphQL-capable endpoint.`;
        console.error(`[sui-watcher] ${detail}`);
        reportWatcherError("sui", new Error(detail));
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
      reportWatcherOk("sui");
    } catch (err) {
      console.error("[sui-watcher]", err);
      reportWatcherError("sui", err);
    }
  };

  await poll();
  return new Promise(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      await poll();
      const failures = watcherHealth.get("sui")?.consecutiveFailures ?? 0;
      setTimeout(() => void tick(), backoffDelayMs(failures, POLL_MS));
    };
    void tick();
    return () => {
      stopped = true;
    };
  });
}

// === Watcher health (surfaced to the frontend via /api/watchers) ========
//
// A watcher that cannot reach its chain's RPC (egress-filtered host,
// deprecated endpoint) still settles nothing — the UI marks those chains
// offline instead of letting users stake into a request that never
// confirms. Health is derived from poll outcomes: `ok` after a successful
// poll, `unreachable` after a failure, with the last error kept for the
// tooltip.

export interface WatcherHealth {
  chain: string;
  status: "ok" | "unreachable" | "unknown";
  lastError: string | null;
  lastSuccessAt: string | null;
  consecutiveFailures: number;
}

const watcherHealth = new Map<string, WatcherHealth>();

function reportWatcherOk(chain: string) {
  const cur =
    watcherHealth.get(chain) ??
    ({ chain, status: "unknown", lastError: null, lastSuccessAt: null, consecutiveFailures: 0 } as WatcherHealth);
  watcherHealth.set(chain, {
    ...cur,
    status: "ok",
    lastError: null,
    lastSuccessAt: new Date().toISOString(),
    consecutiveFailures: 0,
  });
}

function reportWatcherError(chain: string, err: unknown) {
  const cur =
    watcherHealth.get(chain) ??
    ({ chain, status: "unknown", lastError: null, lastSuccessAt: null, consecutiveFailures: 0 } as WatcherHealth);
  watcherHealth.set(chain, {
    ...cur,
    status: "unreachable",
    lastError: err instanceof Error ? err.message : String(err),
    consecutiveFailures: cur.consecutiveFailures + 1,
  });
}

/** Snapshot of every watcher's reachability, for /api/watchers. */
export function watchersHealth(): WatcherHealth[] {
  return [...watcherHealth.values()];
}

/**
 * Exponential backoff helper for watchers whose endpoint is unreachable:
 * polling a dead host every 5 s just fills the log. Delay grows
 * 5s → 10s → … capped at 5 min, resetting on the first success.
 */
export function backoffDelayMs(consecutiveFailures: number, base = 5_000, max = 300_000): number {
  if (consecutiveFailures <= 0) return base;
  const shifted = Math.min(consecutiveFailures, 6); // cap the shift, not just the result
  return Math.min(base * 2 ** (shifted - 1), max);
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
  activeWatchers.push(watchMonad);
  for (const net of COSMOS_NETWORKS) {
    activeWatchers.push(() => watchCosmosChain(net));
  }
  activeWatchers.push(watchSui);
  activeWatchers.push(watchAptos);
  activeWatchers.push(watchPolkadot);
  activeWatchers.push(watchBnb);
  activeWatchers.push(watchSolana);

  // Fire and forget - each watcher starts its own polling loop
  for (const watcher of activeWatchers) {
    watcher().catch((err) => console.error("watcher failed:", err));
  }

  console.log(`[orchestrator] ${activeWatchers.length} chain watchers started`);
}

// Backwards-compatible export for the existing orchestrator.ts
export { findPendingRequest };
