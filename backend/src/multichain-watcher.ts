import { rpcUrls } from "./services/rpc-registry.js";
/**
 * Multichain event watchers: polls each chain's staking events and
 * translates them into Canton Daml choices.
 *
 * Supported chains:
 * - Polygon PoS: StakingInfo ShareMinted / ShareBurnedWithId events on
 *   Ethereum L1 (Sepolia for Amoy) — one ValidatorShare per validator,
 *   resolved per event. NOT the Bor chain, and not a single global contract.
 * - Monad: Staking Delegate / Undelegate / Withdraw events
 * - Cosmos-shape (Cosmos Hub, Celestia mocha, Osmosis testnet):
 *   MsgDelegate transactions via Tendermint tx_search + protobuf decode
 * - Sui: validator::StakingRequestEvent / UnstakingRequestEvent via GraphQL
 * - Aptos: delegation-pool AddStake / UnlockStake / WithdrawStake via
 *   delegator-account REST transactions
 * - Polkadot (Westend): nominationPools.Bonded / staking.Bonded block events
 * - BNB Chain (Chapel): StakeHub Delegated logs
 * - Solana (testnet): Stake Program delegateStake instructions
 */

import {
  createPublicClient,
  decodeFunctionData,
  http,
  parseAbi,
  toFunctionSelector,
  toEventSelector,
  formatEther,
  parseUnits,
  toHex,
  type Address,
} from "viem";
import { fromBase64 } from "@cosmjs/encoding";
import { decodeTxRaw } from "@cosmjs/proto-signing";
import { MsgDelegate, MsgUndelegate } from "cosmjs-types/cosmos/staking/v1beta1/tx";
import { config } from "./config.js";
import { canton, TEMPLATES, type ActiveContract } from "./canton.js";
import { prisma } from "./db.js";
import { handlePolygonUnbondEvent, handlePolygonClaimEvent, featuredRightCidForDaml, extractCreatedContractId, recordStakeEvent } from "./orchestrator.js";
import {
  eventsHubAbi,
  eventsHubAddress,
  settlementClient,
  shareForValidatorId,
  resolveValidatorShare,
  stakingLoggerAbi,
  stakingLoggerAddress,
} from "./services/validator-share.js";
import {
  monadActionAbi,
  monadDelegateAbi,
  monadUndelegateAbi,
  monadWithdrawAbi,
} from "./services/monad-events.js";
import { canonicalAptosAddress, decodeAptosDelegationActions, type AptosAccountTransaction, type AptosDelegationAction } from "./services/aptos-events.js";
import { aptosActionAfterPositionStart, aptosUnbondSnapshot, aptosWithdrawalCompletesPosition } from "./services/aptos-lifecycle.js";
import { normalizeWalletAddress, sameWalletAddress } from "./services/wallet-address.js";
import { assertSolanaNetwork, solanaRpc, SOLANA_GENESIS } from "./services/solana-rpc.js";
import { decodeSolanaStakeAction, type ParsedSolanaTransaction, type SolanaStakeAction, type SolanaStakeBinding } from "./services/solana-staking.js";
import { polkadotApi, POLKADOT_ASSET_HUB, polkadotPoolKey } from "./services/polkadot-rpc.js";
import { decodePolkadotPoolAction, isPolkadotLifecycleEvent, type PolkadotPoolAction, type PolkadotPoolBinding } from "./services/polkadot-staking.js";
import { decodeAddress, encodeAddress } from "@polkadot/util-crypto";
import { verifiedSuiStakingSender } from "./services/sui-staking-sender.js";
import { matchesUnbondProofForRecovery } from "./services/lifecycle-recovery.js";
import { assertEvmRpcChainId } from "./services/evm-network.js";
import { assertSuiChainIdentifier } from "./services/native-network.js";
import { withWatcherFreshness, watcherChainsForLifecycle } from "./services/watcher-gate.js";

// === Shared types ===

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
  /** Validator account, distinct from the Sui staking-pool object. */
  validatorAddress?: string;
  validatorId?: number;
  /** Shares minted — not equal to `amount`; see exchangeRate math. */
  shares?: bigint;
  suiStakedObjectId?: string;
}

/** Scale a base-unit amount with `decimals` decimals into 18-decimal units. */
function toStakeUnits(amount: bigint, decimals: number): bigint {
  if (decimals === 18) return amount;
  if (decimals > 18) return amount / 10n ** BigInt(decimals - 18);
  return amount * 10n ** BigInt(18 - decimals);
}

async function loadWatcherCursor(key: string): Promise<bigint | undefined> {
  const row = await prisma.watcherCursor.findUnique({ where: { key } });
  return row ? BigInt(row.lastScannedBlock) : undefined;
}

async function saveWatcherCursor(key: string, block: bigint): Promise<void> {
  await prisma.watcherCursor.upsert({
    where: { key },
    create: { key, lastScannedBlock: block.toString() },
    update: { lastScannedBlock: block.toString() },
  });
}

// === Polygon PoS (real ValidatorShare, settled on Ethereum L1) ===
//
// Polygon PoS staking does NOT settle on Bor/Amoy. The delegation events we
// need are emitted by StakingInfo (delegation) and EventsHub (nonce-based
// unbond/claim) on Ethereum L1, Sepolia for Amoy. Both carry validatorId, so
// we resolve the validator's share from StakeManager per event.

async function watchPolygon(): Promise<void> {
  const POLL_MS = config.polygonWatcherPollMs;
  const INITIAL_LOOKBACK_BLOCKS = BigInt(config.polygonWatcherLookbackBlocks);
  const MAX_BLOCK_RANGE = BigInt(config.polygonWatcherMaxRange);
  const cursorKey = `polygon:${config.stakeSettlementChainId}`;
  let lastScannedBlock: bigint | undefined;
  let cursorLoaded = false;

  console.log(
    `[polygon-watcher] watching StakingInfo ${stakingLoggerAddress} on chain ` +
      `${config.stakeSettlementChainId} (${rpcUrls["settlement"]})`
  );

  const getMintLogsBatched = async (
    fromBlock: bigint,
    toBlock: bigint
  ) => {
    const out: unknown[] = [];
    for (let from = fromBlock; from <= toBlock; from += MAX_BLOCK_RANGE + 1n) {
      const to = from + MAX_BLOCK_RANGE > toBlock ? toBlock : from + MAX_BLOCK_RANGE;
      const logs = await settlementClient.getContractEvents({
        address: stakingLoggerAddress,
        abi: stakingLoggerAbi,
        eventName: "ShareMinted",
        fromBlock: from,
        toBlock: to,
      });
      out.push(...logs);
    }
    return out;
  };

  const getHubLogsBatched = async (
    hub: Address,
    eventName: "ShareBurnedWithId" | "DelegatorUnstakeWithId",
    fromBlock: bigint,
    toBlock: bigint,
  ) => {
    const out: unknown[] = [];
    for (let from = fromBlock; from <= toBlock; from += MAX_BLOCK_RANGE + 1n) {
      const to = from + MAX_BLOCK_RANGE > toBlock ? toBlock : from + MAX_BLOCK_RANGE;
      const logs = await settlementClient.getContractEvents({
        address: hub,
        abi: eventsHubAbi,
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
      await assertEvmRpcChainId(settlementClient, config.stakeSettlementChainId, "Polygon settlement");
      if (!cursorLoaded) {
        lastScannedBlock = await loadWatcherCursor(cursorKey);
        cursorLoaded = true;
      }
      const rpcHead = await settlementClient.getBlockNumber();
      // Public L1 RPC backends can disagree briefly about the tip. Scanning
      // 12 blocks behind also avoids accepting a reorged staking event.
      const latestBlock = rpcHead > 12n ? rpcHead - 12n : 0n;
      const fromBlock =
        lastScannedBlock === undefined
          ? latestBlock > INITIAL_LOOKBACK_BLOCKS
            ? latestBlock - INITIAL_LOOKBACK_BLOCKS
            : 0n
          : lastScannedBlock + 1n;
      if (fromBlock > latestBlock) return;
      const maxBatchTo = fromBlock + (MAX_BLOCK_RANGE + 1n) * 6n - 1n;
      const scanTo = maxBatchTo < latestBlock ? maxBatchTo : latestBlock;

      const hub = await eventsHubAddress();
      const [minted, burned, claimed] = await Promise.all([
        getMintLogsBatched(fromBlock, scanTo),
        getHubLogsBatched(hub, "ShareBurnedWithId", fromBlock, scanTo),
        getHubLogsBatched(hub, "DelegatorUnstakeWithId", fromBlock, scanTo),
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

      for (const raw of claimed) {
        const log = raw as {
          args: { validatorId?: bigint; user?: Address; amount?: bigint; nonce?: bigint };
          transactionHash: string;
          blockNumber: bigint;
        };
        const { validatorId, user, amount, nonce } = log.args;
        if (validatorId === undefined || user === undefined || amount === undefined || nonce === undefined) continue;
        const share = await shareForValidatorId(validatorId);
        if (!share) continue;
        await handlePolygonClaimEvent({
          user,
          amount,
          nonce,
          validatorId: Number(validatorId),
          validatorShare: share,
          txHash: log.transactionHash,
          blockNumber: Number(log.blockNumber),
        });
      }

      await saveWatcherCursor(cursorKey, scanTo);
      lastScannedBlock = scanTo;
      reportWatcherOk("polygon");
    } catch (err) {
      console.error("[polygon-watcher]", err);
      reportWatcherError("polygon", err);
      // Never skip a persisted cursor: a later provider/archive endpoint can
      // recover this range, whereas re-anchoring silently loses deposits.
    }
  };

  // A transient RPC failure on the FIRST poll must not kill the watcher:
  // the exception would escape startMultichainWatchers() and this chain
  // would never be polled again for the life of the process. Report it
  // and let the tick loop retry with backoff.
  try {
    await poll();
  } catch (err) {
    console.error(`[polygon-watcher] initial poll failed:`, err);
    reportWatcherError("polygon", err);
  }
  return new Promise(() => {
    const tick = async () => {
      await poll();
      setTimeout(() => void tick(), POLL_MS);
    };
    setTimeout(() => void tick(), POLL_MS);
  });
}

// === Monad (Testnet Staking) ===

const monadClient = createPublicClient({
  chain: {
    id: config.networkMode === "mainnet" ? 143 : 10143,
    name: config.networkMode === "mainnet" ? "Monad" : "Monad Testnet",
    nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
    rpcUrls: {
      default: { http: [rpcUrls["monad"]] },
    },
  },
  transport: http(rpcUrls["monad"], { timeout: 16_000, retryCount: 0 }),
});

const MONAD_STAKING_PRECOMPILE: Address = "0x0000000000000000000000000000000000001000" as Address;

async function findMonadPosition(
  delegator: Address,
  validatorId: bigint,
  status: "Bonded" | "Unbonding",
  requestedAmount?: bigint,
): Promise<ActiveContract | undefined> {
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const candidates = active.filter((position) => {
    const arg = position.argument as { evmAddress?: string; status?: string };
    return arg.evmAddress?.toLowerCase() === delegator.toLowerCase() && arg.status === status;
  });
  const mirrors = await prisma.stakingPosition.findMany({
    where: { contractId: { in: candidates.map((position) => position.contractId) }, chain: "monad", status },
  });
  const matching = candidates.filter((position) => mirrors.some((mirror) =>
    mirror.contractId === position.contractId &&
    mirror.validatorId === Number(validatorId),
  ));
  // For legacy wallets with more than one position at a validator, an exact
  // principal match can still disambiguate. New requests prohibit a second
  // position; compounded rewards or slashing can change the exit amount.
  const exact = requestedAmount === undefined ? [] : matching.filter((position) => {
    const mirror = mirrors.find((row) => row.contractId === position.contractId)!;
    return parseUnits(mirror.amountPol, 18) === requestedAmount;
  });
  const selected = exact.length === 1 ? exact : matching;
  if (selected.length !== 1) {
    console.warn(`[monad-watcher] expected one ${status} position for ${delegator} / validator ${validatorId}; found ${matching.length}`);
    return undefined;
  }
  return selected[0];
}

async function handleMonadUnbondEvent(args: {
  delegator: Address;
  validatorId: bigint;
  withdrawId: number;
  requestedAmount: bigint;
  settledAmount: bigint;
  activationEpoch: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
}): Promise<void> {
  if (args.withdrawId !== 0 || args.settledAmount < args.requestedAmount) return;
  const position = await findMonadPosition(args.delegator, args.validatorId, "Bonded", args.requestedAmount);
  if (!position) return;
  const block = await monadClient.getBlock({ blockNumber: args.blockNumber });
  const proof = {
    txHash: args.txHash,
    blockNumber: Number(args.blockNumber),
    validatorShare: MONAD_STAKING_PRECOMPILE,
  };
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition,
    contractId: position.contractId,
    choice: "StakingPosition_ConfirmUnbond",
    argument: {
      proof,
      // Monad uses protocol epochs, not a wall-clock withdrawal deadline.
      // Store the first eligible epoch and gate the UI against getEpoch().
      unbondingReadyEpoch: Number(args.activationEpoch + 1n),
      featuredRightCid: featuredRightCidForDaml(),
    },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`Monad confirmed unbond ${args.txHash} but returned no position CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: position.contractId, chain: "monad", status: "Bonded" },
    data: {
      contractId: newCid,
      status: "Unbonding",
      evmTxHash: args.txHash,
      cantonTxId: result.transactionId,
      unbondingStartedAt: new Date(Number(block.timestamp) * 1000),
      unbondWithdrawEpoch: args.activationEpoch.toString(),
      unbondNonce: String(args.withdrawId),
    },
  });
  if (updated.count !== 1) throw new Error(`Monad unbond mirror was not updated for ${args.txHash}`);
  await recordStakeEvent({
    positionContractId: newCid,
    eventKind: "Unbond",
    txProof: proof,
    occurredAt: new Date(Number(block.timestamp) * 1000).toISOString(),
  });
  console.log(`[monad-watcher] unbonded ${position.contractId} via ${args.txHash}`);
}

async function handleMonadWithdrawEvent(args: {
  delegator: Address;
  validatorId: bigint;
  withdrawId: number;
  payout: bigint;
  withdrawEpoch: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
}): Promise<void> {
  if (args.withdrawId !== 0) return;
  const position = await findMonadPosition(args.delegator, args.validatorId, "Unbonding");
  if (!position) return;
  const mirror = await prisma.stakingPosition.findUnique({ where: { contractId: position.contractId } });
  if (!mirror?.unbondWithdrawEpoch || mirror.unbondNonce !== String(args.withdrawId) ||
      args.withdrawEpoch < BigInt(mirror.unbondWithdrawEpoch) + 1n || args.payout === 0n) {
    // A slashed delegation can legitimately pay out less than the initial
    // stake; the validator, wallet, withdrawal slot, and epoch are the
    // binding proof, not a minimum payout amount.
    throw new Error(`Monad withdrawal ${args.txHash} does not match the tracked slot/epoch`);
  }
  const block = await monadClient.getBlock({ blockNumber: args.blockNumber });
  const proof = {
    txHash: args.txHash,
    blockNumber: Number(args.blockNumber),
    validatorShare: MONAD_STAKING_PRECOMPILE,
  };
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition,
    contractId: position.contractId,
    choice: "StakingPosition_Release",
    argument: { proof },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`Monad withdrew ${args.txHash} but returned no released position CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: position.contractId, chain: "monad", status: "Unbonding" },
    data: {
      contractId: newCid,
      status: "Released",
      evmTxHash: args.txHash,
      cantonTxId: result.transactionId,
      releasedAt: new Date(Number(block.timestamp) * 1000),
    },
  });
  if (updated.count !== 1) throw new Error(`Monad withdrawal mirror was not updated for ${args.txHash}`);
  await recordStakeEvent({
    positionContractId: newCid,
    eventKind: "Release",
    txProof: proof,
    occurredAt: new Date(Number(block.timestamp) * 1000).toISOString(),
  });
  console.log(`[monad-watcher] released ${position.contractId} via ${args.txHash}`);
}

async function watchMonad(): Promise<void> {
  const EVENT_POLL_MS = 5_000;
  const INITIAL_LOOKBACK_BLOCKS = 50n;
  // Monad's public RPC enforces "eth_getLogs is limited to a 100 range"
  // (error -32614, started rejecting 2026-09-08). Batches must stay at or
  // under it.
  const MAX_BLOCK_RANGE = 100n;
  // Bounded catch-up per tick so a backlog drains progressively instead of
  // one unbounded loop.
  const MAX_BATCHES_PER_POLL = 20;
  const cursorKey = `monad:${config.networkMode === "mainnet" ? 143 : 10143}`;
  let lastScannedBlock: bigint | undefined;
  let cursorLoaded = false;

  const poll = async () => {
    try {
      await assertEvmRpcChainId(monadClient, config.networkMode === "mainnet" ? 143 : 10143, "Monad");
      if (!cursorLoaded) {
        lastScannedBlock = await loadWatcherCursor(cursorKey);
        cursorLoaded = true;
      }
      const rpcHead = await monadClient.getBlockNumber();
      const latestBlock = rpcHead > 12n ? rpcHead - 12n : 0n;
      const fromBlock =
        lastScannedBlock === undefined
          ? latestBlock > INITIAL_LOOKBACK_BLOCKS
            ? latestBlock - INITIAL_LOOKBACK_BLOCKS
            : 0n
          : lastScannedBlock + 1n;
      if (fromBlock > latestBlock) return;

      // Never jump over a persisted cursor, even after a long outage. Drain
      // the backlog in bounded RPC ranges; otherwise valid stake proofs
      // could be permanently lost while requests remain pending on Canton.
      let cursor = fromBlock;

      for (
        let batches = 0;
        cursor <= latestBlock && batches < MAX_BATCHES_PER_POLL;
        batches++
      ) {
        const to =
          cursor + MAX_BLOCK_RANGE - 1n > latestBlock
            ? latestBlock
            : cursor + MAX_BLOCK_RANGE - 1n;

        const [delegated, undelegated, withdrawn] = await Promise.all([
          monadClient.getLogs({ address: MONAD_STAKING_PRECOMPILE, event: monadDelegateAbi, fromBlock: cursor, toBlock: to }),
          monadClient.getLogs({ address: MONAD_STAKING_PRECOMPILE, event: monadUndelegateAbi, fromBlock: cursor, toBlock: to }),
          monadClient.getLogs({ address: MONAD_STAKING_PRECOMPILE, event: monadWithdrawAbi, fromBlock: cursor, toBlock: to }),
        ]);

        for (const log of delegated) {
          const args = log.args;
          if (args.delegator === undefined || args.amount === undefined || args.validatorId === undefined) continue;
          // Delegate is also emitted by addValidator and compound. Only a
          // direct payable delegate(uint64) transaction can satisfy a user's
          // pending stake intent; otherwise an unrelated event could match
          // the same address and amount.
          const tx = await monadClient.getTransaction({ hash: log.transactionHash });
          if (tx.to?.toLowerCase() !== MONAD_STAKING_PRECOMPILE.toLowerCase() ||
              !tx.input.startsWith("0x84994fec") ||
              tx.from.toLowerCase() !== args.delegator.toLowerCase() ||
              tx.value !== args.amount) continue;
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

        for (const log of undelegated) {
          const args = log.args;
          if (args.delegator === undefined || args.validatorId === undefined || args.withdrawId === undefined ||
              args.amount === undefined || args.activationEpoch === undefined) continue;
          const tx = await monadClient.getTransaction({ hash: log.transactionHash });
          if (tx.to?.toLowerCase() !== MONAD_STAKING_PRECOMPILE.toLowerCase() ||
              !tx.input.startsWith("0x5cf41514") ||
              tx.from.toLowerCase() !== args.delegator.toLowerCase()) continue;
          const decoded = decodeFunctionData({ abi: monadActionAbi, data: tx.input });
          if (decoded.functionName !== "undelegate" || decoded.args[0] !== args.validatorId ||
              decoded.args[2] !== args.withdrawId) continue;
          await handleMonadUnbondEvent({
            delegator: args.delegator,
            validatorId: args.validatorId,
            withdrawId: args.withdrawId,
            requestedAmount: decoded.args[1],
            settledAmount: args.amount,
            activationEpoch: args.activationEpoch,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          });
        }

        for (const log of withdrawn) {
          const args = log.args;
          if (args.delegator === undefined || args.validatorId === undefined || args.withdrawId === undefined ||
              args.amount === undefined || args.withdrawEpoch === undefined) continue;
          const tx = await monadClient.getTransaction({ hash: log.transactionHash });
          if (tx.to?.toLowerCase() !== MONAD_STAKING_PRECOMPILE.toLowerCase() ||
              !tx.input.startsWith("0xaed2ee73") ||
              tx.from.toLowerCase() !== args.delegator.toLowerCase()) continue;
          const decoded = decodeFunctionData({ abi: monadActionAbi, data: tx.input });
          if (decoded.functionName !== "withdraw" || decoded.args[0] !== args.validatorId ||
              decoded.args[1] !== args.withdrawId) continue;
          await handleMonadWithdrawEvent({
            delegator: args.delegator,
            validatorId: args.validatorId,
            withdrawId: args.withdrawId,
            payout: args.amount,
            withdrawEpoch: args.withdrawEpoch,
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          });
        }

        // Persist per batch, not once at the end. A failed batch is retried
        // at the same block after restart.
        await saveWatcherCursor(cursorKey, to);
        lastScannedBlock = to;
        cursor = to + 1n;
      }

      reportWatcherOk("monad");
    } catch (err) {
      console.error("[monad-watcher]", err);
      reportWatcherError("monad", err);
    }
  };

  // A transient RPC failure on the FIRST poll must not kill the watcher:
  // the exception would escape startMultichainWatchers() and this chain
  // would never be polled again for the life of the process. Report it
  // and let the tick loop retry with backoff.
  try {
    await poll();
  } catch (err) {
    console.error(`[monad-watcher] initial poll failed:`, err);
    reportWatcherError("monad", err);
  }
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
// Aptos delegated staking uses 0x1::delegation_pool entry functions. Scan
// each tracked account's sequence and verify both its entry payload and
// typed pool event before settling an intent or position on Canton.

async function aptosGetJson<T>(base: string, path: string): Promise<T> {
  const response = await fetch(`${base}/v1${path}`);
  if (!response.ok) throw new Error(`Aptos ${path} returned ${response.status}`);
  return response.json() as Promise<T>;
}

async function findAptosPosition(action: AptosDelegationAction, status: "Bonded" | "Unbonding"): Promise<ActiveContract | undefined> {
  const mirrors = (await prisma.stakingPosition.findMany({ where: { chain: "aptos", status } }))
    .filter((row) => canonicalAptosAddress(row.evmAddress) === action.delegator &&
      canonicalAptosAddress(row.validatorAddress) === action.pool &&
      (status !== "Unbonding" || !row.unbondingStartedAt || row.unbondingStartedAt <= action.timestamp));
  const ids = new Set(mirrors.map((row) => row.contractId));
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const matches = active.filter((position) => {
    const arg = position.argument as { status?: string; bondedAt?: string };
    return ids.has(position.contractId) && arg.status === status && aptosActionAfterPositionStart(action, arg.bondedAt);
  });
  if (matches.length > 1) throw new Error(`Ambiguous Aptos ${status} positions for ${action.delegator} / ${action.pool}`);
  return matches[0];
}

async function recoverAptosTransition(action: AptosDelegationAction, from: "Bonded" | "Unbonding", base: string): Promise<boolean> {
  const to = from === "Bonded" ? "Unbonding" : "Released";
  const mirrors = (await prisma.stakingPosition.findMany({ where: { chain: "aptos", status: from } }))
    .filter((row) => canonicalAptosAddress(row.evmAddress) === action.delegator &&
      canonicalAptosAddress(row.validatorAddress) === action.pool);
  if (mirrors.length > 1) throw new Error(`Ambiguous Aptos ${from} mirror for ${action.delegator} / ${action.pool}`);
  if (mirrors.length === 0) return false;
  const mirror = mirrors[0]!;
  if (from === "Unbonding" && mirror.unbondingStartedAt && action.timestamp < mirror.unbondingStartedAt) return false;
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  // A recent scan can include exits from an older position in the same
  // pool. Do not apply those receipts to a later staking request.
  const current = active.find((position) => position.contractId === mirror.contractId);
  if (current && !aptosActionAfterPositionStart(action, (current.argument as { bondedAt?: string }).bondedAt)) return false;
  const matches = active.filter((position) => {
    const arg = position.argument as { status?: string; evmAddress?: string; amountPol?: string; bondedAt?: string;
      lastUnbondProof?: { txHash?: string; validatorShare?: string } };
    return arg.status === to && canonicalAptosAddress(arg.evmAddress) === action.delegator &&
      aptosActionAfterPositionStart(action, arg.bondedAt, from === "Unbonding" ? mirror.unbondingStartedAt : undefined) &&
      normalizeDecimal(arg.amountPol) === normalizeDecimal(mirror.amountPol) &&
      canonicalAptosAddress(arg.lastUnbondProof?.validatorShare) === action.pool &&
      matchesUnbondProofForRecovery(from, action.txHash, mirror.evmTxHash, arg.lastUnbondProof?.txHash);
  });
  if (matches.length !== 1) throw new Error(`Cannot recover Aptos ${from} transition for ${action.txHash}`);
  const unbond = from === "Bonded" ? await aptosUnbondSnapshot(base, action) : null;
  if (from === "Bonded" ? !unbond : !await aptosWithdrawalCompletesPosition(base, action)) return false;
  const proof = { txHash: action.txHash, blockNumber: Number(action.version), validatorShare: action.pool };
  const newCid = matches[0]!.contractId;
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: mirror.contractId, chain: "aptos", status: from },
    data: from === "Bonded"
      ? { contractId: newCid, status: to, evmTxHash: action.txHash,
          unbondingStartedAt: action.timestamp, unbondingReadyAt: unbond!.readyAt,
          unbondAmountBaseUnits: unbond!.amountOcta.toString() }
      : { contractId: newCid, status: to, evmTxHash: action.txHash, releasedAt: action.timestamp },
  });
  if (updated.count !== 1) throw new Error(`Aptos ${from} recovery mirror changed for ${action.txHash}`);
  await recordStakeEvent({ positionContractId: newCid, eventKind: from === "Bonded" ? "Unbond" : "Release",
    txProof: proof, occurredAt: action.timestamp.toISOString() });
  return true;
}

async function handleAptosUnlock(action: AptosDelegationAction, base: string): Promise<void> {
  const position = await findAptosPosition(action, "Bonded");
  if (!position) { await recoverAptosTransition(action, "Bonded", base); return; }
  const unbond = await aptosUnbondSnapshot(base, action);
  if (!unbond) return;
  // This is a projection only. The release proof is the later, settled
  // WithdrawStake event; lockup time is never used to auto-release funds.
  const { readyAt } = unbond;
  const proof = { txHash: action.txHash, blockNumber: Number(action.version), validatorShare: action.pool };
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition,
    contractId: position.contractId,
    choice: "StakingPosition_ConfirmUnbond",
    argument: { proof, unbondingReadyEpoch: Math.floor(readyAt.getTime() / 1000), featuredRightCid: featuredRightCidForDaml() },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`Aptos unlock ${action.txHash} returned no position CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: position.contractId, chain: "aptos", status: "Bonded" },
    data: { contractId: newCid, status: "Unbonding", evmTxHash: action.txHash,
      cantonTxId: result.transactionId, unbondingStartedAt: action.timestamp,
      unbondingReadyAt: readyAt, unbondAmountBaseUnits: unbond.amountOcta.toString() },
  });
  if (updated.count !== 1) throw new Error(`Aptos unlock mirror was not updated for ${action.txHash}`);
  await recordStakeEvent({ positionContractId: newCid, eventKind: "Unbond", txProof: proof, occurredAt: action.timestamp.toISOString() });
}

async function handleAptosWithdraw(action: AptosDelegationAction, base: string): Promise<void> {
  const position = await findAptosPosition(action, "Unbonding");
  if (!position) { await recoverAptosTransition(action, "Unbonding", base); return; }
  // Read the post-transaction state, not today's state: a later withdrawal
  // must never turn an earlier partial withdrawal into a full-release proof.
  if (!await aptosWithdrawalCompletesPosition(base, action)) return;
  const proof = { txHash: action.txHash, blockNumber: Number(action.version), validatorShare: action.pool };
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition,
    contractId: position.contractId,
    choice: "StakingPosition_Release",
    argument: { proof },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`Aptos withdraw ${action.txHash} returned no position CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: position.contractId, chain: "aptos", status: "Unbonding" },
    data: { contractId: newCid, status: "Released", evmTxHash: action.txHash,
      cantonTxId: result.transactionId, releasedAt: action.timestamp },
  });
  if (updated.count !== 1) throw new Error(`Aptos withdraw mirror was not updated for ${action.txHash}`);
  await recordStakeEvent({ positionContractId: newCid, eventKind: "Release", txProof: proof, occurredAt: action.timestamp.toISOString() });
}

async function watchAptos(): Promise<void> {
  const POLL_MS = 12_000;
  const PAGE = 50;
  const base = rpcUrls["aptos"].replace(/\/$/, "");
  const poll = async () => {
    const info = await aptosGetJson<{ chain_id?: number }>(base, "");
    const expected = config.networkMode === "mainnet" ? 1 : 2;
    if (info.chain_id !== expected) throw new Error(`Aptos RPC chain ${info.chain_id} does not match ${config.networkMode} (${expected})`);

    const requests = await canton.activeContracts(TEMPLATES.StakingRequest);
    const [intents, positions] = await Promise.all([
      prisma.stakingIntent.findMany({ where: { chain: "aptos", acceptedAt: null,
        OR: [
          { requestContractId: { in: requests.map((request) => request.contractId) } },
          { acceptedTxHash: { not: null } },
        ] } }),
      prisma.stakingPosition.findMany({ where: { chain: "aptos", status: { in: ["Bonded", "Unbonding"] } } }),
    ]);
    const addresses = new Set([...intents.map((row) => row.evmAddress), ...positions.map((row) => row.evmAddress)]
      .map(canonicalAptosAddress).filter((value): value is string => !!value));

    for (const address of addresses) {
      const cursorKey = `aptos:${expected}:${address}`;
      let next = await loadWatcherCursor(cursorKey);
      if (next === undefined) {
        const account = await aptosGetJson<{ sequence_number?: string }>(base, `/accounts/${address}`);
        const current = BigInt(account.sequence_number ?? "0");
        // Aptos public fullnodes prune old ledger versions. The first scan
        // covers recent account transactions without replaying ancient ones.
        next = current > 100n ? current - 100n : 0n;
      }
      // Scan this delegator's sequence, not the global ledger. A busy Aptos
      // ledger can emit far more than 50 transactions between polling ticks.
      for (let page = 0; page < 10; page++) {
        const response = await fetch(`${base}/v1/accounts/${address}/transactions?start=${next}&limit=${PAGE}`);
        if (response.status === 404) break;
        if (!response.ok) throw new Error(`Aptos account transactions for ${address} returned ${response.status}`);
        const txs = await response.json() as AptosAccountTransaction[];
        if (!Array.isArray(txs)) throw new Error("Aptos account transactions returned invalid data");
        for (const tx of txs) {
          if (tx.sequence_number === undefined) throw new Error(`Aptos transaction missing sequence number for ${address}`);
          const sequence = BigInt(tx.sequence_number);
          if (sequence < next) continue;
          for (const action of decodeAptosDelegationActions(tx)) {
            if (action.delegator !== address) continue;
            if (action.kind === "stake") {
              const requestedAmount = normalizeDecimal(formatEther(toStakeUnits(action.amountOcta, 8)));
              const eligible = intents.some((intent) =>
                canonicalAptosAddress(intent.evmAddress) === address &&
                canonicalAptosAddress(intent.validatorAddress) === action.pool &&
                normalizeDecimal(intent.amountPol) === requestedAmount &&
                (intent.acceptedTxHash === action.txHash || intent.createdAt <= action.timestamp));
              if (!eligible) continue;
              await handleStakeEvent({ evmAddress: action.delegator, amount: toStakeUnits(action.amountOcta, 8),
                txHash: action.txHash, blockNumber: Number(action.version),
                chain: "aptos", validatorShare: action.pool });
            } else if (action.kind === "unlock") {
              await handleAptosUnlock(action, base);
            } else {
              await handleAptosWithdraw(action, base);
            }
          }
          next = sequence + 1n;
          await saveWatcherCursor(cursorKey, next);
        }
        if (txs.length < PAGE) break;
      }
    }
    reportWatcherOk("aptos");
  };

  try { await poll(); }
  catch (err) { console.error("[aptos-watcher] initial poll failed:", err); reportWatcherError("aptos", err); }
  return new Promise(() => {
    let stopped = false;
    const tick = async () => {
      if (stopped) return;
      try { await poll(); }
      catch (err) { console.error("[aptos-watcher]", err); reportWatcherError("aptos", err); }
      const failures = watcherHealth.get("aptos")?.consecutiveFailures ?? 0;
      setTimeout(() => void tick(), backoffDelayMs(failures, POLL_MS));
    };
    void tick();
    return () => { stopped = true; };
  });
}

// === Solana (testnet, account model) ======================================
//
// A separate stake account is bound to each Canton intent before signing.
// Scan that account's finalized signatures, not the global Stake Program:
// the latter is busy and does not prove wallet ownership or exact amount.

async function findSolanaPosition(action: SolanaStakeAction, status: "Bonded" | "Unbonding"): Promise<ActiveContract | undefined> {
  const mirrors = await prisma.stakingPosition.findMany({
    where: { chain: "solana", status, evmAddress: action.wallet, validatorShare: action.stakeAccount },
  });
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const ids = new Set(mirrors.map((row) => row.contractId));
  const matches = active.filter((row) => ids.has(row.contractId) && (row.argument as { status?: string }).status === status);
  if (matches.length > 1) throw new Error(`Ambiguous Solana ${status} position for ${action.stakeAccount}`);
  return matches[0];
}

async function recoverSolanaTransition(action: SolanaStakeAction, from: "Bonded" | "Unbonding"): Promise<boolean> {
  const to = from === "Bonded" ? "Unbonding" : "Released";
  const mirrors = await prisma.stakingPosition.findMany({
    where: { chain: "solana", status: from, evmAddress: action.wallet, validatorShare: action.stakeAccount },
  });
  if (mirrors.length > 1) throw new Error(`Ambiguous Solana ${from} mirror for ${action.stakeAccount}`);
  if (mirrors.length === 0) return false;
  const mirror = mirrors[0]!;
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const matches = active.filter((row) => {
    const arg = row.argument as { status?: string; evmAddress?: string; lastBondProof?: { validatorShare?: string };
      lastUnbondProof?: { txHash?: string; validatorShare?: string } };
    return arg.status === to && arg.evmAddress === action.wallet &&
      arg.lastBondProof?.validatorShare === action.stakeAccount &&
      arg.lastUnbondProof?.validatorShare === action.stakeAccount &&
      matchesUnbondProofForRecovery(from, action.txHash, mirror.evmTxHash, arg.lastUnbondProof?.txHash);
  });
  if (matches.length !== 1) throw new Error(`Cannot recover Solana ${from} transition for ${action.txHash}`);
  const newCid = matches[0]!.contractId;
  const proof = { txHash: action.txHash, blockNumber: action.slot, validatorShare: action.stakeAccount };
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: mirror.contractId, chain: "solana", status: from },
    data: from === "Bonded"
      ? { contractId: newCid, status: to, evmTxHash: action.txHash, unbondingStartedAt: action.timestamp }
      : { contractId: newCid, status: to, evmTxHash: action.txHash, releasedAt: action.timestamp },
  });
  if (updated.count !== 1) throw new Error(`Solana ${from} recovery mirror changed for ${action.txHash}`);
  await recordStakeEvent({ positionContractId: newCid, eventKind: from === "Bonded" ? "Unbond" : "Release",
    txProof: proof, occurredAt: action.timestamp.toISOString() });
  return true;
}

async function handleSolanaDeactivate(action: SolanaStakeAction): Promise<void> {
  const position = await findSolanaPosition(action, "Bonded");
  if (!position) { await recoverSolanaTransition(action, "Bonded"); return; }
  // Cooling duration depends on epoch warmup/cooldown. This timestamp is a
  // display estimate only; a finalized full withdrawal is the release proof.
  const readyAt = new Date(action.timestamp.getTime() + 2 * 86_400_000);
  const proof = { txHash: action.txHash, blockNumber: action.slot, validatorShare: action.stakeAccount };
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition, contractId: position.contractId,
    choice: "StakingPosition_ConfirmUnbond",
    argument: { proof, unbondingReadyEpoch: Math.floor(readyAt.getTime() / 1000), featuredRightCid: featuredRightCidForDaml() },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`Solana deactivate ${action.txHash} returned no position CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: position.contractId, chain: "solana", status: "Bonded" },
    data: { contractId: newCid, status: "Unbonding", evmTxHash: action.txHash, cantonTxId: result.transactionId,
      unbondingStartedAt: action.timestamp, unbondingReadyAt: readyAt },
  });
  if (updated.count !== 1) throw new Error(`Solana deactivate mirror was not updated for ${action.txHash}`);
  await recordStakeEvent({ positionContractId: newCid, eventKind: "Unbond", txProof: proof, occurredAt: action.timestamp.toISOString() });
}

async function handleSolanaWithdraw(action: SolanaStakeAction): Promise<void> {
  const position = await findSolanaPosition(action, "Unbonding");
  if (!position) { await recoverSolanaTransition(action, "Unbonding"); return; }
  const proof = { txHash: action.txHash, blockNumber: action.slot, validatorShare: action.stakeAccount };
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition, contractId: position.contractId,
    choice: "StakingPosition_Release", argument: { proof },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`Solana withdraw ${action.txHash} returned no released position CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: position.contractId, chain: "solana", status: "Unbonding" },
    data: { contractId: newCid, status: "Released", evmTxHash: action.txHash,
      cantonTxId: result.transactionId, releasedAt: action.timestamp },
  });
  if (updated.count !== 1) throw new Error(`Solana withdraw mirror was not updated for ${action.txHash}`);
  await recordStakeEvent({ positionContractId: newCid, eventKind: "Release", txProof: proof, occurredAt: action.timestamp.toISOString() });
}

async function watchSolana(): Promise<void> {
  const POLL_MS = 15_000;
  const poll = async () => {
    await assertSolanaNetwork();
    const requests = await canton.activeContracts(TEMPLATES.StakingRequest);
    const [intents, positions] = await Promise.all([
      prisma.stakingIntent.findMany({ where: { chain: "solana",
        OR: [
          { requestContractId: { in: requests.map((request) => request.contractId) }, acceptedAt: null },
          { acceptedTxHash: { not: null }, acceptedAt: null },
        ] } }),
      prisma.stakingPosition.findMany({ where: { chain: "solana", status: { in: ["Bonded", "Unbonding"] } } }),
    ]);
    const accountIds = new Set([...intents.map((intent) => intent.stakeAccountAddress), ...positions.map((position) => position.validatorShare)]
      .filter((value): value is string => !!value));
    for (const stakeAccount of accountIds) {
      const intent = await prisma.stakingIntent.findUnique({ where: { stakeAccountAddress: stakeAccount } });
      if (!intent?.validatorAddress || !intent.stakeRentLamports) {
        throw new Error(`Solana stake account ${stakeAccount} has no complete Canton intent binding`);
      }
      const binding: SolanaStakeBinding = {
        wallet: intent.evmAddress, stakeAccount, voteAccount: intent.validatorAddress,
        amountLamports: parseUnits(intent.amountPol, 9), rentLamports: BigInt(intent.stakeRentLamports),
      };
      const cursorKey = `solana:${SOLANA_GENESIS[config.networkMode]}:${stakeAccount}`;
      const saved = await prisma.watcherCursor.findUnique({ where: { key: cursorKey } });
      const previous = saved?.lastScannedBlock;
      const newestFirst: Array<{ signature: string; err: unknown }> = [];
      let before: string | undefined;
      for (let page = 0; page < 10; page++) {
        const pageRows = await solanaRpc<Array<{ signature: string; err: unknown }>>("getSignaturesForAddress", [
          stakeAccount, { limit: 100, commitment: "finalized", ...(previous ? { until: previous } : {}), ...(before ? { before } : {}) },
        ]);
        if (!Array.isArray(pageRows)) throw new Error(`Solana signatures for ${stakeAccount} returned invalid data`);
        newestFirst.push(...pageRows);
        if (pageRows.length < 100) break;
        before = pageRows.at(-1)?.signature;
        if (page === 9) throw new Error(`Solana signature backlog for ${stakeAccount} exceeds 1000; archival RPC is required`);
      }
      for (const signature of newestFirst.reverse()) {
        if (signature.err === null) {
          const tx = await solanaRpc<ParsedSolanaTransaction | null>("getTransaction", [
            signature.signature,
            { encoding: "jsonParsed", maxSupportedTransactionVersion: 0, commitment: "finalized" },
          ]);
          if (!tx) throw new Error(`Finalized Solana transaction ${signature.signature} is unavailable; use an archival RPC`);
          if (tx.transaction?.signatures?.[0] !== signature.signature) throw new Error("Solana RPC returned a mismatched transaction signature");
          const action = decodeSolanaStakeAction(tx, binding);
          if (action?.kind === "stake" && !intent.acceptedAt && intent.createdAt <= action.timestamp) {
            await handleStakeEvent({
              evmAddress: action.wallet, amount: toStakeUnits(action.amountLamports, 9),
              txHash: action.txHash, blockNumber: action.slot, chain: "solana",
              validatorShare: action.stakeAccount, validatorAddress: action.voteAccount,
            });
          } else if (action?.kind === "deactivate") {
            await handleSolanaDeactivate(action);
          } else if (action?.kind === "withdraw") {
            await handleSolanaWithdraw(action);
          }
        }
        await prisma.watcherCursor.upsert({
          where: { key: cursorKey },
          create: { key: cursorKey, lastScannedBlock: signature.signature },
          update: { lastScannedBlock: signature.signature },
        });
      }
    }
    reportWatcherOk("solana");
  };

  // A transient RPC failure on the FIRST poll must not kill the watcher:
  // the exception would escape startMultichainWatchers() and this chain
  // would never be polled again for the life of the process. Report it
  // and let the tick loop retry with backoff.
  try {
    await poll();
  } catch (err) {
    console.error(`[solana-watcher] initial poll failed:`, err);
    reportWatcherError("solana", err);
  }
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

// Asset Hub nomination pools are the staking runtime. The obsolete
// relay-chain scanner was removed; it could not verify member exits.
function canonicalPolkadotAddress(address: string): string | null {
  try {
    return encodeAddress(decodeAddress(address), config.networkMode === "mainnet" ? 0 : 42);
  } catch {
    return null;
  }
}

async function findPolkadotPosition(action: PolkadotPoolAction, status: "Bonded" | "Unbonding"): Promise<ActiveContract | undefined> {
  const key = polkadotPoolKey(action.poolId);
  const mirrors = await prisma.stakingPosition.findMany({ where: {
    chain: "polkadot", evmAddress: action.wallet, validatorShare: key, status,
  } });
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const ids = new Set(mirrors.map((row) => row.contractId));
  const matches = active.filter((row) => ids.has(row.contractId) && (row.argument as { status?: string }).status === status);
  if (matches.length > 1) throw new Error(`Ambiguous Polkadot ${status} position for ${action.wallet} in ${key}`);
  return matches[0];
}

async function recoverPolkadotTransition(action: PolkadotPoolAction, from: "Bonded" | "Unbonding"): Promise<boolean> {
  const key = polkadotPoolKey(action.poolId);
  const to = from === "Bonded" ? "Unbonding" : "Released";
  const mirrors = await prisma.stakingPosition.findMany({ where: {
    chain: "polkadot", evmAddress: action.wallet, validatorShare: key, status: from,
  } });
  if (mirrors.length > 1) throw new Error(`Ambiguous Polkadot ${from} mirror for ${action.wallet} / ${key}`);
  if (mirrors.length === 0) return false;
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const matches = active.filter((row) => {
    const arg = row.argument as { status?: string; evmAddress?: string;
      lastBondProof?: { validatorShare?: string }; lastUnbondProof?: { txHash?: string; validatorShare?: string } };
    return arg.status === to && arg.evmAddress === action.wallet && arg.lastBondProof?.validatorShare === key &&
      arg.lastUnbondProof?.validatorShare === key &&
      matchesUnbondProofForRecovery(from, action.txHash, mirrors[0]!.evmTxHash, arg.lastUnbondProof?.txHash);
  });
  if (matches.length !== 1) throw new Error(`Cannot recover Polkadot ${from} transition for ${action.txHash}`);
  const newCid = matches[0]!.contractId;
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: mirrors[0]!.contractId, chain: "polkadot", status: from },
    data: from === "Bonded"
      ? { contractId: newCid, status: to, evmTxHash: action.txHash, unbondingStartedAt: action.timestamp }
      : { contractId: newCid, status: to, evmTxHash: action.txHash, releasedAt: action.timestamp },
  });
  if (updated.count !== 1) throw new Error(`Polkadot ${from} recovery mirror changed for ${action.txHash}`);
  await recordStakeEvent({ positionContractId: newCid, eventKind: from === "Bonded" ? "Unbond" : "Release",
    txProof: { txHash: action.txHash, blockNumber: action.blockNumber, validatorShare: key },
    occurredAt: action.timestamp.toISOString() });
  return true;
}

async function handlePolkadotUnbond(action: PolkadotPoolAction): Promise<void> {
  const position = await findPolkadotPosition(action, "Bonded");
  if (!position) { await recoverPolkadotTransition(action, "Bonded"); return; }
  const key = polkadotPoolKey(action.poolId);
  const proof = { txHash: action.txHash, blockNumber: action.blockNumber, validatorShare: key };
  // Era length is runtime-dependent. This timestamp is not a claim gate;
  // wallet withdrawal checks the actual unbonding eras on Asset Hub.
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition, contractId: position.contractId,
    choice: "StakingPosition_ConfirmUnbond",
    argument: { proof, unbondingReadyEpoch: Math.floor(action.timestamp.getTime() / 1000), featuredRightCid: featuredRightCidForDaml() },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`Polkadot unbond ${action.txHash} returned no position CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: position.contractId, chain: "polkadot", status: "Bonded" },
    data: { contractId: newCid, status: "Unbonding", evmTxHash: action.txHash,
      cantonTxId: result.transactionId, unbondingStartedAt: action.timestamp },
  });
  if (updated.count !== 1) throw new Error(`Polkadot unbond mirror was not updated for ${action.txHash}`);
  await recordStakeEvent({ positionContractId: newCid, eventKind: "Unbond", txProof: proof,
    occurredAt: action.timestamp.toISOString() });
}

async function handlePolkadotWithdraw(action: PolkadotPoolAction): Promise<void> {
  const position = await findPolkadotPosition(action, "Unbonding");
  if (!position) { await recoverPolkadotTransition(action, "Unbonding"); return; }
  const key = polkadotPoolKey(action.poolId);
  const proof = { txHash: action.txHash, blockNumber: action.blockNumber, validatorShare: key };
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition, contractId: position.contractId,
    choice: "StakingPosition_Release", argument: { proof },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`Polkadot withdrawal ${action.txHash} returned no position CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: position.contractId, chain: "polkadot", status: "Unbonding" },
    data: { contractId: newCid, status: "Released", evmTxHash: action.txHash,
      cantonTxId: result.transactionId, releasedAt: action.timestamp },
  });
  if (updated.count !== 1) throw new Error(`Polkadot withdrawal mirror was not updated for ${action.txHash}`);
  await recordStakeEvent({ positionContractId: newCid, eventKind: "Release", txProof: proof,
    occurredAt: action.timestamp.toISOString() });
}

async function watchPolkadotAssetHub(): Promise<void> {
  const POLL_MS = 15_000;
  const poll = async () => {
    const api = await polkadotApi();
    const cursorKey = `polkadot:${POLKADOT_ASSET_HUB[config.networkMode].genesis}`;
    const head = await api.rpc.chain.getFinalizedHead();
    const height = (await api.rpc.chain.getHeader(head)).number.toNumber();
    const cursor = await prisma.watcherCursor.upsert({
      where: { key: cursorKey }, create: { key: cursorKey, lastScannedBlock: String(height) }, update: {},
    });
    const last = Number(cursor.lastScannedBlock);
    if (!Number.isSafeInteger(last) || last > height) throw new Error(`Invalid Polkadot watcher cursor ${cursor.lastScannedBlock}`);
    for (let blockNumber = last + 1; blockNumber <= Math.min(height, last + 100); blockNumber++) {
      const hash = await api.rpc.chain.getBlockHash(blockNumber);
      const at = await api.at(hash);
      const [rawRecords, rawTime] = await Promise.all([at.query.system.events(), at.query.timestamp.now()]);
      const timestamp = new Date(Number(rawTime.toString()));
      if (!Number.isFinite(timestamp.getTime())) throw new Error(`Polkadot block ${blockNumber} has invalid timestamp`);
      const records = rawRecords as unknown as Array<{
        phase: { isApplyExtrinsic: boolean; asApplyExtrinsic: { toNumber(): number } };
        event: { section: string; method: string; data: { toArray(): Array<{ toString(): string }> } };
      }>;
      // Inspect authoritative events before decoding extrinsics. Unrelated
      // mainnet v5 reward-compounding batches cannot be decoded as SignedBlock
      // by this SDK, but must not stop observation of our v4 wallet flow.
      const indices = [...new Set(records.filter((record) => record.phase.isApplyExtrinsic &&
        isPolkadotLifecycleEvent({ section: record.event.section, method: record.event.method,
          data: record.event.data.toArray().map((value) => value.toString()) }))
        .map((record) => record.phase.asApplyExtrinsic.toNumber()))];
      const rawBlock = indices.length ? await api.rpc.chain.getBlock.raw(hash) as unknown as {
        block?: { header?: { parentHash?: string }; extrinsics?: string[] };
      } : null;
      for (const index of indices) {
        const events = records.filter((record) => record.phase.isApplyExtrinsic && record.phase.asApplyExtrinsic.toNumber() === index)
          .map((record) => ({ section: record.event.section, method: record.event.method,
            data: record.event.data.toArray().map((value) => value.toString()) }));
        for (const poolEvent of events.filter(isPolkadotLifecycleEvent)) {
          const wallet = canonicalPolkadotAddress(poolEvent.data[0] ?? "");
          const poolId = Number(poolEvent.data[1]);
          if (!wallet || !Number.isSafeInteger(poolId) || poolId <= 0) continue;
          const key = polkadotPoolKey(poolId);
          const [intents, mirrors] = await Promise.all([
            prisma.stakingIntent.findMany({ where: { chain: "polkadot", evmAddress: wallet,
              validatorAddress: key, acceptedAt: null } }),
            prisma.stakingPosition.findMany({ where: { chain: "polkadot", evmAddress: wallet,
              validatorShare: key, status: { in: ["Bonded", "Unbonding"] } } }),
          ]);
          const bindings: Array<{ binding: PolkadotPoolBinding; createdAt?: Date; status?: string }> = [
            ...intents.map((intent) => ({ binding: { wallet, poolId,
              amountPlanck: parseUnits(intent.amountPol, POLKADOT_ASSET_HUB[config.networkMode].decimals) }, createdAt: intent.createdAt })),
            ...mirrors.map((mirror) => ({ binding: { wallet, poolId,
              amountPlanck: parseUnits(mirror.amountPol, POLKADOT_ASSET_HUB[config.networkMode].decimals) }, status: mirror.status })),
          ];
          if (bindings.length === 0) continue;
          const hex = rawBlock?.block?.extrinsics?.[index];
          const parentHash = rawBlock?.block?.header?.parentHash;
          if (!hex || !/^0x[0-9a-f]+$/i.test(hex) || !parentHash || !/^0x[0-9a-f]{64}$/i.test(parentHash)) {
            throw new Error(`Polkadot tracked extrinsic ${blockNumber}:${index} is unavailable`);
          }
          // Use the execution runtime (parent metadata). A decode error for a
          // tracked transition still fails closed and preserves the cursor.
          const parent = await api.at(parentHash);
          const extrinsic = parent.registry.createType("Extrinsic", hex);
          if (!extrinsic.isSigned || extrinsic.method.section !== "nominationPools") continue;
          const signer = canonicalPolkadotAddress(extrinsic.signer.toString());
          if (!signer) continue;
          const encoded = { hash: extrinsic.hash.toHex(), signer, section: extrinsic.method.section,
            method: extrinsic.method.method, success: events.some((event) => event.section === "system" && event.method === "ExtrinsicSuccess"), events };
          for (const candidate of bindings) {
            const action = decodePolkadotPoolAction(encoded, candidate.binding, blockNumber, timestamp);
            if (!action) continue;
            const state = (await at.query.nominationPools.poolMembers(wallet)).toJSON() as { poolId?: number; points?: string | number; unbondingEras?: Record<string, unknown> } | null;
            if (action.kind === "join" && candidate.createdAt && candidate.createdAt <= timestamp) {
              await handleStakeEvent({ evmAddress: wallet, amount: toStakeUnits(action.amountPlanck, POLKADOT_ASSET_HUB[config.networkMode].decimals),
                txHash: action.txHash, blockNumber, chain: "polkadot", validatorShare: key, validatorAddress: key });
            } else if (action.kind === "unbond" && candidate.status === "Bonded" && state?.poolId === poolId &&
                       BigInt(String(state.points ?? 0)) === 0n && Object.keys(state.unbondingEras ?? {}).length > 0) {
              await handlePolkadotUnbond(action);
            } else if (action.kind === "withdraw" && candidate.status === "Unbonding") {
              // MemberRemoved in this exact successful extrinsic is the
              // authoritative full-exit proof. A later join in the same block
              // may recreate membership, so block-end state is not a gate.
              await handlePolkadotWithdraw(action);
            }
          }
        }
      }
      await prisma.watcherCursor.update({ where: { key: cursorKey }, data: { lastScannedBlock: String(blockNumber) } });
    }
    reportWatcherOk("polkadot");
  };
  try { await poll(); }
  catch (error) { console.error("[polkadot-watcher] initial poll failed:", error); reportWatcherError("polkadot", error); }
  return new Promise(() => {
    const tick = async () => {
      try { await poll(); }
      catch (error) { console.error("[polkadot-watcher]", error); reportWatcherError("polkadot", error); }
      setTimeout(() => void tick(), backoffDelayMs(watcherHealth.get("polkadot")?.consecutiveFailures ?? 0, POLL_MS));
    };
    void tick();
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
const BNB_DELEGATE_SELECTOR = toFunctionSelector("delegate(address,bool)");
const BNB_UNDELEGATE_SELECTOR = toFunctionSelector("undelegate(address,uint256)");
const BNB_CLAIM_SELECTOR = toFunctionSelector("claim(address,uint256)");
const bnbActionAbi = parseAbi([
  "function undelegate(address operatorAddress, uint256 shares)",
  "function claim(address operatorAddress, uint256 requestNumber)",
]);
const bnbParamsAbi = parseAbi(["function unbondPeriod() view returns (uint256)"]);
const BNB_UNDELEGATED_TOPIC = toEventSelector("Undelegated(address,address,uint256,uint256)");
const BNB_CLAIMED_TOPIC = toEventSelector("Claimed(address,address,uint256)");

const bnbClient = createPublicClient({
  chain: {
    id: config.networkMode === "mainnet" ? 56 : 97,
    name: config.networkMode === "mainnet" ? "BNB Smart Chain" : "BNB Smart Chain Chapel",
    nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrls["bnb"]] } },
  },
  transport: http(rpcUrls["bnb"], { timeout: 16_000, retryCount: 0 }),
});

async function findBnbPosition(
  delegator: Address,
  operator: Address,
  status: "Bonded" | "Unbonding",
  shares?: bigint,
): Promise<ActiveContract | undefined> {
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const candidates = active.filter((p) => {
    const arg = p.argument as { evmAddress?: string; status?: string };
    return arg.evmAddress?.toLowerCase() === delegator.toLowerCase() && arg.status === status;
  });
  const mirrors = await prisma.stakingPosition.findMany({
    where: { contractId: { in: candidates.map((p) => p.contractId) }, chain: "bnb", status },
  });
  const matching = candidates.filter((p) => mirrors.some((m) =>
    m.contractId === p.contractId &&
    m.validatorShare?.toLowerCase() === operator.toLowerCase() &&
    (shares === undefined || m.amountShares === shares.toString()),
  ));
  if (matching.length !== 1) {
    console.warn(`[bnb-watcher] expected one ${status} position for ${delegator} / ${operator}; found ${matching.length}`);
    return undefined;
  }
  return matching[0];
}

async function handleBnbUnbondEvent(args: {
  operator: Address;
  delegator: Address;
  shares: bigint;
  amount: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
}): Promise<void> {
  const position = await findBnbPosition(args.delegator, args.operator, "Bonded", args.shares);
  if (!position) return;
  const [block, unbondPeriod] = await Promise.all([
    bnbClient.getBlock({ blockNumber: args.blockNumber }),
    bnbClient.readContract({ address: BNB_STAKE_HUB, abi: bnbParamsAbi, functionName: "unbondPeriod", blockNumber: args.blockNumber }),
  ]);
  const readyAt = Number(block.timestamp + unbondPeriod);
  const proof = {
    txHash: args.txHash,
    blockNumber: Number(args.blockNumber),
    validatorShare: args.operator,
  };
  try {
    const result = await canton.exerciseChoice({
      templateId: TEMPLATES.StakingPosition,
      contractId: position.contractId,
      choice: "StakingPosition_ConfirmUnbond",
      argument: {
        proof,
        unbondingReadyEpoch: readyAt,
        featuredRightCid: featuredRightCidForDaml(),
      },
    });
    const newCid = extractCreatedContractId(result.events);
    if (!newCid) throw new Error("Canton confirmed BNB unbond but returned no new position CID");
    const updated = await prisma.stakingPosition.updateMany({
      where: { contractId: position.contractId, chain: "bnb", status: "Bonded" },
      data: {
        contractId: newCid,
        status: "Unbonding",
        evmTxHash: args.txHash,
        cantonTxId: result.transactionId,
        unbondingStartedAt: new Date(Number(block.timestamp) * 1000),
        unbondingReadyAt: new Date(readyAt * 1000),
        unbondingPeriod: (unbondPeriod * 1_000_000n).toString(),
      },
    });
    if (updated.count !== 1) throw new Error("BNB unbond position mirror was not updated");
    await recordStakeEvent({
      positionContractId: newCid,
      eventKind: "Unbond",
      txProof: proof,
      occurredAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    });
    console.log(`[bnb-watcher] unbonded ${position.contractId} via ${args.txHash}`);
  } catch (err) {
    console.error(`[bnb-watcher] failed to confirm unbond ${args.txHash}:`, err);
    throw err;
  }
}

async function handleBnbClaimEvent(args: {
  operator: Address;
  delegator: Address;
  amount: bigint;
  txHash: `0x${string}`;
  blockNumber: bigint;
}): Promise<void> {
  const position = await findBnbPosition(args.delegator, args.operator, "Unbonding");
  if (!position) return;
  const block = await bnbClient.getBlock({ blockNumber: args.blockNumber });
  const mirror = await prisma.stakingPosition.findUnique({ where: { contractId: position.contractId } });
  if (!mirror?.unbondingReadyAt || block.timestamp < BigInt(Math.ceil(mirror.unbondingReadyAt.getTime() / 1000))) {
    console.warn(`[bnb-watcher] claim preceded tracked BNB unbond maturity for ${position.contractId}`);
    return;
  }
  const proof = {
    txHash: args.txHash,
    blockNumber: Number(args.blockNumber),
    validatorShare: args.operator,
  };
  try {
    const result = await canton.exerciseChoice({
      templateId: TEMPLATES.StakingPosition,
      contractId: position.contractId,
      choice: "StakingPosition_Release",
      argument: { proof },
    });
    const newCid = extractCreatedContractId(result.events);
    if (!newCid) throw new Error("Canton released BNB stake but returned no new position CID");
    const updated = await prisma.stakingPosition.updateMany({
      where: { contractId: position.contractId, chain: "bnb", status: "Unbonding" },
      data: {
        contractId: newCid,
        status: "Released",
        evmTxHash: args.txHash,
        cantonTxId: result.transactionId,
        releasedAt: new Date(Number(block.timestamp) * 1000),
      },
    });
    if (updated.count !== 1) throw new Error("BNB claimed position mirror was not updated");
    await recordStakeEvent({
      positionContractId: newCid,
      eventKind: "Release",
      txProof: proof,
      occurredAt: new Date(Number(block.timestamp) * 1000).toISOString(),
    });
    console.log(`[bnb-watcher] released ${position.contractId} via ${args.txHash}`);
  } catch (err) {
    console.error(`[bnb-watcher] failed to release claim ${args.txHash}:`, err);
    throw err;
  }
}

async function watchBnb(): Promise<void> {
  const POLL_MS = 12_000;
  const LOOKBACK = 3000n;
  const cursorKey = `bnb:${config.networkMode === "mainnet" ? 56 : 97}`;
  let lastScanned: bigint | undefined;
  let cursorLoaded = false;

  const poll = async () => {
    await assertEvmRpcChainId(bnbClient, config.networkMode === "mainnet" ? 56 : 97, "BNB");
    if (!cursorLoaded) {
      lastScanned = await loadWatcherCursor(cursorKey);
      cursorLoaded = true;
    }
    const rpcHead = await bnbClient.getBlockNumber();
    const finalized = rpcHead > 15n ? rpcHead - 15n : 0n;
    const from = lastScanned === undefined
      ? finalized > LOOKBACK ? finalized - LOOKBACK : 0n
      : lastScanned + 1n;
    if (from > finalized) return;
    const latest = from + 499n < finalized ? from + 499n : finalized;

    type BnbRawLog = {
      topics: string[];
      data: `0x${string}`;
      transactionHash: `0x${string}`;
      blockNumber: string;
    };
    const fetchLogs = async (topic: `0x${string}`): Promise<BnbRawLog[]> =>
      bnbClient.request({
        method: "eth_getLogs",
        params: [{
          address: BNB_STAKE_HUB,
          topics: [topic],
          fromBlock: toHex(from),
          toBlock: toHex(latest),
        }],
      }) as Promise<BnbRawLog[]>;
    const [delegated, undelegated, claimed] = await Promise.all([
      fetchLogs(BNB_DELEGATED_TOPIC),
      fetchLogs(BNB_UNDELEGATED_TOPIC),
      fetchLogs(BNB_CLAIMED_TOPIC),
    ]);

    for (const log of delegated) {
      if (log.topics.length < 3) continue;
      const operator = `0x${log.topics[1]!.slice(26)}` as Address;
      const delegator = `0x${log.topics[2]!.slice(26)}` as Address;
      // data = abi.encode(shares: uint256, bnbAmount: uint256)
      const data = log.data.slice(2);
      if (data.length < 128) continue;
      const bnbAmount = BigInt(`0x${data.slice(64, 128)}`);
      const shares = BigInt(`0x${data.slice(0, 64)}`);
      if (bnbAmount === 0n) continue;
      const tx = await bnbClient.getTransaction({ hash: log.transactionHash });
      if (tx.to?.toLowerCase() !== BNB_STAKE_HUB.toLowerCase() ||
          !tx.input.startsWith(BNB_DELEGATE_SELECTOR) ||
          tx.from.toLowerCase() !== delegator.toLowerCase() ||
          tx.value !== bnbAmount) continue;

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
    for (const log of undelegated) {
      if (log.topics.length < 3) continue;
      const operator = `0x${log.topics[1]!.slice(26)}` as Address;
      const delegator = `0x${log.topics[2]!.slice(26)}` as Address;
      const data = log.data.slice(2);
      if (data.length < 128) continue;
      const shares = BigInt(`0x${data.slice(0, 64)}`);
      const amount = BigInt(`0x${data.slice(64, 128)}`);
      if (shares === 0n || amount === 0n) continue;
      const tx = await bnbClient.getTransaction({ hash: log.transactionHash });
      if (tx.to?.toLowerCase() !== BNB_STAKE_HUB.toLowerCase() ||
          !tx.input.startsWith(BNB_UNDELEGATE_SELECTOR) ||
          tx.from.toLowerCase() !== delegator.toLowerCase()) continue;
      const decoded = decodeFunctionData({ abi: bnbActionAbi, data: tx.input });
      if (decoded.functionName !== "undelegate" ||
          decoded.args[0].toLowerCase() !== operator.toLowerCase() ||
          decoded.args[1] !== shares) continue;
      await handleBnbUnbondEvent({
        operator, delegator, shares, amount,
        txHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber),
      });
    }
    for (const log of claimed) {
      if (log.topics.length < 3) continue;
      const operator = `0x${log.topics[1]!.slice(26)}` as Address;
      const delegator = `0x${log.topics[2]!.slice(26)}` as Address;
      const data = log.data.slice(2);
      if (data.length < 64) continue;
      const amount = BigInt(`0x${data.slice(0, 64)}`);
      if (amount === 0n) continue;
      const tx = await bnbClient.getTransaction({ hash: log.transactionHash });
      if (tx.to?.toLowerCase() !== BNB_STAKE_HUB.toLowerCase() ||
          !tx.input.startsWith(BNB_CLAIM_SELECTOR) ||
          tx.from.toLowerCase() !== delegator.toLowerCase()) continue;
      const decoded = decodeFunctionData({ abi: bnbActionAbi, data: tx.input });
      if (decoded.functionName !== "claim" ||
          decoded.args[0].toLowerCase() !== operator.toLowerCase() ||
          decoded.args[1] !== 0n) continue;
      await handleBnbClaimEvent({
        operator, delegator, amount,
        txHash: log.transactionHash,
        blockNumber: BigInt(log.blockNumber),
      });
    }
    await saveWatcherCursor(cursorKey, latest);
    lastScanned = latest;
    reportWatcherOk("bnb");
  };

  // A transient RPC failure on the FIRST poll must not kill the watcher:
  // the exception would escape startMultichainWatchers() and this chain
  // would never be polled again for the life of the process. Report it
  // and let the tick loop retry with backoff.
  try {
    await poll();
  } catch (err) {
    console.error(`[bnb-watcher] initial poll failed:`, err);
    reportWatcherError("bnb", err);
  }
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
  expectedChainId?: string;
  bondDenom: string;
  pollMs: number;
}

const COSMOS_NETWORKS: CosmosNetwork[] = [
  {
    chain: "cosmos",
    rpcUrl: rpcUrls["cosmos"],
    expectedChainId: config.networkMode === "mainnet" ? "cosmoshub-4" : "provider",
    bondDenom: "uatom",
    pollMs: 10_000,
  },
  {
    chain: "celestia",
    rpcUrl: rpcUrls["celestia"],
    expectedChainId: config.networkMode === "mainnet" ? "celestia" : "mocha-5",
    bondDenom: "utia",
    pollMs: 10_000,
  },
  {
    chain: "osmosis",
    rpcUrl: rpcUrls["osmosis"],
    expectedChainId: config.networkMode === "mainnet" ? "osmosis-1" : "osmo-test-5",
    bondDenom: "uosmo",
    pollMs: 10_000,
  },
];

async function findCosmosPosition(args: {
  chain: string;
  delegator: string;
  validator: string;
  status: "Bonded" | "Unbonding";
  amountBaseUnits: bigint;
}): Promise<ActiveContract | undefined> {
  const mirrors = await prisma.stakingPosition.findMany({
    where: {
      chain: args.chain,
      evmAddress: args.delegator.toLowerCase(),
      validatorAddress: args.validator,
      status: args.status,
    },
  });
  const active = await canton.activeContracts(TEMPLATES.StakingPosition);
  const amountDecimal = normalizeDecimal(formatEther(toStakeUnits(args.amountBaseUnits, 6)));
  const matching = active.filter((position) => {
    const arg = position.argument as { evmAddress?: string; status?: string };
    return arg.evmAddress?.toLowerCase() === args.delegator.toLowerCase() &&
      arg.status === args.status && mirrors.some((mirror) =>
        mirror.contractId === position.contractId &&
        (args.status === "Bonded"
          ? normalizeDecimal(mirror.amountPol) === amountDecimal
          : mirror.unbondAmountBaseUnits === args.amountBaseUnits.toString()),
      );
  });
  if (matching.length > 1) {
    throw new Error(`Ambiguous ${args.chain} ${args.status} positions for ${args.delegator} / ${args.validator}`);
  }
  return matching[0];
}

async function handleCosmosUnbondEvent(args: {
  net: CosmosNetwork;
  delegator: string;
  validator: string;
  requestedAmount: bigint;
  settledAmount: bigint;
  readyAt: Date;
  txHash: string;
  height: number;
}): Promise<void> {
  if (args.requestedAmount <= 0n || args.settledAmount <= 0n) return;
  const position = await findCosmosPosition({
    chain: args.net.chain,
    delegator: args.delegator,
    validator: args.validator,
    status: "Bonded",
    amountBaseUnits: args.requestedAmount,
  });
  if (!position) return;
  const proof = { txHash: args.txHash, blockNumber: args.height, validatorShare: args.validator };
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition,
    contractId: position.contractId,
    choice: "StakingPosition_ConfirmUnbond",
    argument: {
      proof,
      unbondingReadyEpoch: Math.floor(args.readyAt.getTime() / 1000),
      featuredRightCid: featuredRightCidForDaml(),
    },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`${args.net.chain} unbond ${args.txHash} returned no position CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: position.contractId, chain: args.net.chain, status: "Bonded" },
    data: {
      contractId: newCid,
      status: "Unbonding",
      evmTxHash: args.txHash,
      cantonTxId: result.transactionId,
      unbondingStartedAt: new Date(),
      unbondingReadyAt: args.readyAt,
      unbondNonce: String(args.height),
      unbondAmountBaseUnits: args.settledAmount.toString(),
    },
  });
  if (updated.count !== 1) throw new Error(`${args.net.chain} unbond mirror was not updated for ${args.txHash}`);
  await recordStakeEvent({
    positionContractId: newCid,
    eventKind: "Unbond",
    txProof: proof,
    occurredAt: new Date().toISOString(),
  });
  console.log(`[${args.net.chain}-watcher] unbonded ${position.contractId} via ${args.txHash}`);
}

async function handleCosmosCompletionEvent(args: {
  net: CosmosNetwork;
  delegator: string;
  validator: string;
  amountBaseUnits: bigint;
  height: number;
  blockHash: string;
  blockTime: Date;
}): Promise<void> {
  const position = await findCosmosPosition({
    chain: args.net.chain,
    delegator: args.delegator,
    validator: args.validator,
    status: "Unbonding",
    amountBaseUnits: args.amountBaseUnits,
  });
  if (!position) return;
  const mirror = await prisma.stakingPosition.findUnique({ where: { contractId: position.contractId } });
  if (!mirror?.unbondingReadyAt || args.blockTime < mirror.unbondingReadyAt) return;
  // Cosmos pays principal automatically in EndBlock. There is no claim tx;
  // identify the actual block commitment explicitly in the text proof field
  // rather than inventing a transaction hash.
  const proof = {
    txHash: `${args.net.chain}:block:${args.blockHash}`,
    blockNumber: args.height,
    validatorShare: args.validator,
  };
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition,
    contractId: position.contractId,
    choice: "StakingPosition_Release",
    argument: { proof },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`${args.net.chain} completion at block ${args.height} returned no position CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: position.contractId, chain: args.net.chain, status: "Unbonding" },
    data: {
      contractId: newCid,
      status: "Released",
      evmTxHash: proof.txHash,
      cantonTxId: result.transactionId,
      releasedAt: args.blockTime,
    },
  });
  if (updated.count !== 1) throw new Error(`${args.net.chain} completion mirror was not updated at block ${args.height}`);
  await recordStakeEvent({
    positionContractId: newCid,
    eventKind: "Release",
    txProof: proof,
    occurredAt: args.blockTime.toISOString(),
  });
  console.log(`[${args.net.chain}-watcher] released ${position.contractId} at block ${args.height}`);
}

interface CosmosEvent {
  type: string;
  attributes?: Array<{ key: string; value: string }>;
}

interface CosmosTx {
  height: string;
  hash: string;
  tx?: string;
  tx_result?: { code?: number; events?: CosmosEvent[] };
}

function cosmosEventAttribute(event: CosmosEvent, key: string): string | undefined {
  return event.attributes?.find((attribute) => attribute.key === key)?.value;
}

function cosmosAmount(raw: string | undefined, denom: string): bigint | undefined {
  if (!raw?.endsWith(denom)) return undefined;
  const digits = raw.slice(0, -denom.length);
  return /^\d+$/.test(digits) ? BigInt(digits) : undefined;
}

// Search by bounded height, then page through every result. A cursor is
// persisted only after *all* tx and EndBlock events in the window settle.
async function watchCosmosChain(net: CosmosNetwork): Promise<void> {
  const rpc = async <T>(method: string, params: Record<string, string> = {}): Promise<T> => {
    const res = await fetch(net.rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    });
    if (!res.ok) throw new Error(`${method} HTTP ${res.status}`);
    const body = (await res.json()) as { result?: T; error?: { message?: string } };
    if (body.error || !body.result) throw new Error(`${method}: ${body.error?.message ?? "missing result"}`);
    return body.result;
  };
  const paged = async <T>(method: string, query: string, field: string): Promise<T[]> => {
    const all: T[] = [];
    for (let page = 1; page <= 100; page++) {
      const result = await rpc<Record<string, unknown>>(method, {
        query, page: String(page), per_page: "100", order_by: "asc",
      });
      const batch = result[field] as T[] | undefined;
      const total = Number(result.total_count);
      if (!Array.isArray(batch) || !Number.isSafeInteger(total) || total < 0) {
        throw new Error(`${method} returned malformed pagination`);
      }
      all.push(...batch);
      if (all.length >= total) return all;
      if (batch.length === 0) throw new Error(`${method} returned an empty page before ${total} results`);
    }
    throw new Error(`${method} exceeded 100 pages; window will be retried`);
  };
  const cursorKey = `cosmos:${net.chain}:${config.networkMode}`;
  let lastCheckedHeight: bigint | undefined;
  const poll = async () => {
    const status = await rpc<{ node_info?: { network?: string }; sync_info?: { latest_block_height?: string; catching_up?: boolean } }>("status");
    if (net.expectedChainId && status.node_info?.network !== net.expectedChainId) {
      throw new Error(`RPC chain ID ${status.node_info?.network ?? "unknown"} is not ${net.expectedChainId}`);
    }
    if (status.sync_info?.catching_up) throw new Error("RPC node is still catching up");
    const tip = BigInt(status.sync_info?.latest_block_height ?? "0");
    if (lastCheckedHeight === undefined) {
      lastCheckedHeight = await loadWatcherCursor(cursorKey) ?? (tip > 5_000n ? tip - 5_000n : 0n);
    }
    // Leave two blocks of finality and make one bounded pass per tick.
    const to = tip > 2n ? (lastCheckedHeight + 100n < tip - 2n ? lastCheckedHeight + 100n : tip - 2n) : 0n;
    if (to <= lastCheckedHeight) return;
    const from = lastCheckedHeight + 1n;
    const range = ` AND tx.height>=${from} AND tx.height<=${to}`;

    for (const typeUrl of ["/cosmos.staking.v1beta1.MsgDelegate", "/cosmos.staking.v1beta1.MsgUndelegate"]) {
      const txs = await paged<CosmosTx>("tx_search", `message.action='${typeUrl}'${range}`, "txs");
      for (const tx of txs) {
        if (tx.tx_result?.code !== 0) continue;
        if (!tx.tx || !Number.isSafeInteger(Number(tx.height))) throw new Error(`Malformed ${typeUrl} tx ${tx.hash}`);
        const height = Number(tx.height);
        const messages = decodeTxRaw(fromBase64(tx.tx)).body.messages;
        for (const [index, message] of messages.entries()) {
          if (message.typeUrl !== typeUrl) continue;
          if (typeUrl.endsWith("MsgDelegate")) {
            const msg = MsgDelegate.decode(message.value);
            if (msg.amount?.denom !== net.bondDenom) continue;
            const amount = BigInt(msg.amount.amount);
            if (amount <= 0n) continue;
            await handleStakeEvent({
              evmAddress: msg.delegatorAddress,
              amount: toStakeUnits(amount, 6),
              txHash: tx.hash.toUpperCase(),
              blockNumber: height,
              chain: net.chain,
              validatorShare: msg.validatorAddress,
            });
            continue;
          }
          const msg = MsgUndelegate.decode(message.value);
          if (msg.amount?.denom !== net.bondDenom) continue;
          const requestedAmount = BigInt(msg.amount.amount);
          const event = tx.tx_result?.events?.find((entry) => entry.type === "unbond" &&
            cosmosEventAttribute(entry, "validator") === msg.validatorAddress &&
            cosmosEventAttribute(entry, "delegator") === msg.delegatorAddress &&
            cosmosEventAttribute(entry, "msg_index") === String(index));
          if (!event) throw new Error(`Missing unbond event for tx ${tx.hash}, message ${index}`);
          const settledAmount = cosmosAmount(cosmosEventAttribute(event, "amount"), net.bondDenom);
          const readyAt = new Date(cosmosEventAttribute(event, "completion_time") ?? "");
          if (settledAmount === undefined || !Number.isFinite(readyAt.getTime())) {
            throw new Error(`Malformed unbond event for tx ${tx.hash}`);
          }
          await handleCosmosUnbondEvent({ net, delegator: msg.delegatorAddress,
            validator: msg.validatorAddress, requestedAmount, settledAmount,
            readyAt, txHash: tx.hash.toUpperCase(), height });
        }
      }
    }

    const blocks = await paged<{
      block?: { header?: { height?: string; time?: string } };
      block_id?: { hash?: string };
    }>("block_search", `complete_unbonding.delegator EXISTS AND block.height>=${from} AND block.height<=${to}`, "blocks");
    for (const block of blocks) {
      const height = Number(block.block?.header?.height);
      const blockHash = block.block_id?.hash;
      const blockTime = new Date(block.block?.header?.time ?? "");
      if (!Number.isSafeInteger(height) || !blockHash || !Number.isFinite(blockTime.getTime())) {
        throw new Error("Malformed completion block");
      }
      const results = await rpc<{ finalize_block_events?: CosmosEvent[] }>("block_results", { height: String(height) });
      for (const event of results.finalize_block_events ?? []) {
        if (event.type !== "complete_unbonding") continue;
        const delegator = cosmosEventAttribute(event, "delegator");
        const validator = cosmosEventAttribute(event, "validator");
        const amountBaseUnits = cosmosAmount(cosmosEventAttribute(event, "amount"), net.bondDenom);
        if (!delegator || !validator || amountBaseUnits === undefined) throw new Error(`Malformed completion event at ${height}`);
        await handleCosmosCompletionEvent({ net, delegator, validator, amountBaseUnits, height, blockHash, blockTime });
      }
    }

    await saveWatcherCursor(cursorKey, to);
    lastCheckedHeight = to;
    reportWatcherOk(net.chain);
  };
  const tick = async () => {
    try { await poll(); }
    catch (err) { console.error(`[${net.chain}-watcher]`, err); reportWatcherError(net.chain, err); }
    finally { setTimeout(() => void tick(), net.pollMs); }
  };
  void tick();
}

// === Sui GraphQL staking events ==========================================

const SUI_STAKE_EVENT = "0x3::validator::StakingRequestEvent";
const SUI_UNSTAKE_EVENT = "0x3::validator::UnstakingRequestEvent";

interface SuiStakeEvent {
  cursor: string;
  node: {
    sender?: { address?: string };
    contents?: { json?: Record<string, string> };
    timestamp?: string;
    transaction?: {
      digest?: string;
      sender?: { address?: string };
      effects?: { checkpoint?: { sequenceNumber?: number }; status?: string };
    };
  };
}

async function suiGraphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
  const res = await fetch(rpcUrls["sui"], {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Sui GraphQL HTTP ${res.status}`);
  const body = (await res.json()) as { data?: T; errors?: Array<{ message?: string }> };
  if (body.errors?.length || !body.data) {
    throw new Error(`Sui GraphQL: ${body.errors?.map((e) => e.message).join("; ") ?? "missing data"}`);
  }
  return body.data;
}

async function suiReceiptFromTransaction(args: {
  digest: string;
  poolId: string;
  principalMist: bigint;
  direction: "created" | "deleted";
}): Promise<string> {
  const matches: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page++) {
    const data: {
      transaction?: { effects?: { objectChanges?: {
        nodes?: Array<{
          address?: string;
          idCreated?: boolean;
          idDeleted?: boolean;
          inputState?: { asMoveObject?: { contents?: { type?: { repr?: string }; json?: Record<string, string> } } };
          outputState?: { asMoveObject?: { contents?: { type?: { repr?: string }; json?: Record<string, string> } } };
        }>;
        pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
      } } };
    } = await suiGraphql(`query($digest: String!, $after: String) {
      transaction(digest: $digest) { effects { objectChanges(first: 50, after: $after) {
        nodes { address idCreated idDeleted
          inputState { asMoveObject { contents { type { repr } json } } }
          outputState { asMoveObject { contents { type { repr } json } } }
        }
        pageInfo { hasNextPage endCursor }
      } } }
    }`, { digest: args.digest, after: cursor });
    const changes = data.transaction?.effects?.objectChanges;
    if (!changes?.nodes || !changes.pageInfo) throw new Error(`Incomplete Sui receipt changes for ${args.digest}`);
    for (const change of changes.nodes) {
      if (args.direction === "created" ? !change.idCreated : !change.idDeleted) continue;
      const contents = (args.direction === "created" ? change.outputState : change.inputState)?.asMoveObject?.contents;
      if (contents?.type?.repr?.endsWith("::StakedSui") &&
          contents.json?.pool_id?.toLowerCase() === args.poolId.toLowerCase() &&
          contents.json?.principal === args.principalMist.toString() && change.address) {
        matches.push(change.address);
      }
    }
    if (!changes.pageInfo.hasNextPage) {
      if (matches.length !== 1) throw new Error(`Expected one ${args.direction} StakedSui receipt for ${args.digest}; found ${matches.length}`);
      return matches[0]!;
    }
    if (!changes.pageInfo.endCursor || changes.pageInfo.endCursor === cursor) throw new Error(`Sui receipt pagination stalled for ${args.digest}`);
    cursor = changes.pageInfo.endCursor;
  }
  throw new Error(`Sui receipt changes exceeded 100 pages for ${args.digest}`);
}

async function handleSuiUnstake(args: {
  staker: string;
  validator: string;
  poolId: string;
  principalMist: bigint;
  receiptId: string;
  digest: string;
  checkpoint: number;
  timestamp: Date;
}): Promise<void> {
  const mirrors = await prisma.stakingPosition.findMany({ where: {
    chain: "sui", evmAddress: args.staker.toLowerCase(),
    validatorAddress: { equals: args.validator, mode: "insensitive" },
    validatorShare: { equals: args.poolId, mode: "insensitive" },
    suiStakedObjectId: { equals: args.receiptId, mode: "insensitive" },
    status: { in: ["Bonded", "Unbonding"] },
  } });
  if (mirrors.length === 0) return;
  if (mirrors.length !== 1) throw new Error(`Ambiguous Sui receipt ${args.receiptId}`);
  let mirror = mirrors[0]!;
  if (normalizeDecimal(mirror.amountPol) !== normalizeDecimal(formatEther(toStakeUnits(args.principalMist, 9)))) {
    throw new Error(`Sui receipt ${args.receiptId} principal does not match its Canton position`);
  }
  const proof = { txHash: args.digest, blockNumber: args.checkpoint, validatorShare: args.poolId };
  if (mirror.status === "Bonded") {
    const result = await canton.exerciseChoice({
      templateId: TEMPLATES.StakingPosition, contractId: mirror.contractId,
      choice: "StakingPosition_ConfirmUnbond",
      argument: { proof, unbondingReadyEpoch: Math.floor(args.timestamp.getTime() / 1000),
        featuredRightCid: featuredRightCidForDaml() },
    });
    const newCid = extractCreatedContractId(result.events);
    if (!newCid) throw new Error(`Sui unstake ${args.digest} returned no Unbonding CID`);
    const updated = await prisma.stakingPosition.updateMany({
      where: { contractId: mirror.contractId, chain: "sui", status: "Bonded" },
      data: { contractId: newCid, status: "Unbonding", evmTxHash: args.digest,
        cantonTxId: result.transactionId, unbondingStartedAt: args.timestamp,
        unbondingReadyAt: args.timestamp },
    });
    if (updated.count !== 1) throw new Error(`Sui unbond mirror failed for ${args.digest}`);
    await recordStakeEvent({ positionContractId: newCid, eventKind: "Unbond",
      txProof: proof, occurredAt: args.timestamp.toISOString() });
    mirror = { ...mirror, contractId: newCid, status: "Unbonding" };
  }
  // request_withdraw_stake transfers principal and rewards in this same tx.
  const result = await canton.exerciseChoice({
    templateId: TEMPLATES.StakingPosition, contractId: mirror.contractId,
    choice: "StakingPosition_Release", argument: { proof },
  });
  const newCid = extractCreatedContractId(result.events);
  if (!newCid) throw new Error(`Sui unstake ${args.digest} returned no Released CID`);
  const updated = await prisma.stakingPosition.updateMany({
    where: { contractId: mirror.contractId, chain: "sui", status: "Unbonding" },
    data: { contractId: newCid, status: "Released", evmTxHash: args.digest,
      cantonTxId: result.transactionId, releasedAt: args.timestamp },
  });
  if (updated.count !== 1) throw new Error(`Sui release mirror failed for ${args.digest}`);
  await recordStakeEvent({ positionContractId: newCid, eventKind: "Release",
    txProof: proof, occurredAt: args.timestamp.toISOString() });
  console.log(`[sui-watcher] released ${args.receiptId} via ${args.digest}`);
}

async function watchSui(): Promise<void> {
  const cursors = new Map<string, string>();
  for (const type of [SUI_STAKE_EVENT, SUI_UNSTAKE_EVENT]) {
    const key = `sui:graphql:${config.networkMode}:${type}`;
    const persisted = await prisma.watcherCursor.findUnique({ where: { key } });
    if (persisted) cursors.set(type, persisted.lastScannedBlock);
  }
  const pollType = async (type: string) => {
    const cursor = cursors.get(type);
    const data = await suiGraphql<{
      chainIdentifier?: string;
      events?: { edges?: SuiStakeEvent[]; pageInfo?: { hasNextPage?: boolean } };
    }>(`query($type: String!${cursor ? ", $cursor: String!" : ""}) {
      chainIdentifier
      events(${cursor ? "first: 50, after: $cursor" : "last: 50"}, filter: {type: $type}) {
        edges { cursor node { sender { address } contents { json } timestamp
          transaction { digest sender { address } effects { checkpoint { sequenceNumber } status } } } }
        pageInfo { hasNextPage }
      }
    }`, cursor ? { type, cursor } : { type });
    assertSuiChainIdentifier(data.chainIdentifier);
    const edges = data.events?.edges;
    if (!edges) throw new Error("Sui GraphQL returned no event connection");
    for (const edge of edges) {
      const node = edge.node;
      const json = node.contents?.json;
      const staker = json?.staker_address;
      const eventSender = node.sender?.address;
      const transactionSender = node.transaction?.sender?.address;
      const validator = json?.validator_address;
      const poolId = json?.pool_id;
      const digest = node.transaction?.digest;
      const checkpoint = node.transaction?.effects?.checkpoint?.sequenceNumber;
      const timestamp = new Date(node.timestamp ?? "");
      if (!staker ||
          !validator || !poolId || !digest || !Number.isSafeInteger(checkpoint) ||
          node.transaction?.effects?.status !== "SUCCESS" || !Number.isFinite(timestamp.getTime())) {
        throw new Error(`Malformed Sui ${type} event at cursor ${edge.cursor}`);
      }
      const principal = type === SUI_STAKE_EVENT ? json?.amount : json?.principal_amount;
      if (!principal || !/^\d+$/.test(principal) || BigInt(principal) <= 0n) {
        throw new Error(`Malformed Sui principal for ${digest}`);
      }
      const principalMist = BigInt(principal);
      const sender = verifiedSuiStakingSender(staker, eventSender, transactionSender);
      // Sui testnet emits system epoch staking events with both sender fields
      // null. They cannot prove a user action. Ignore unrelated ones, but do
      // not advance past a matching Canton position/request without proof.
      if (!sender) {
        if (type === SUI_STAKE_EVENT) {
          const pending = await prisma.stakingIntent.findFirst({ where: {
            chain: "sui", evmAddress: staker.toLowerCase(), acceptedAt: null,
            validatorAddress: { equals: validator, mode: "insensitive" },
          } });
          if (pending && await findPendingRequest(staker, toStakeUnits(principalMist, 9), "sui", poolId, undefined, validator)) {
            throw new Error(`Sui event ${digest} matches a pending request but has no verifiable sender`);
          }
        } else {
          const tracked = await prisma.stakingPosition.findFirst({ where: {
            chain: "sui", evmAddress: staker.toLowerCase(),
            validatorAddress: { equals: validator, mode: "insensitive" },
            validatorShare: { equals: poolId, mode: "insensitive" },
            status: { in: ["Bonded", "Unbonding"] },
          } });
          if (tracked) throw new Error(`Sui event ${digest} matches a position but has no verifiable sender`);
        }
        continue;
      }
      if (type === SUI_STAKE_EVENT) {
        const match = await findPendingRequest(staker, toStakeUnits(principalMist, 9), "sui", poolId, undefined, validator);
        if (!match) {
          const recovering = await prisma.stakingIntent.findFirst({ where: {
            chain: "sui", evmAddress: staker.toLowerCase(), acceptedTxHash: digest,
            acceptedAt: null, validatorAddress: { equals: validator, mode: "insensitive" },
          } });
          if (!recovering) continue;
        }
        const receiptId = await suiReceiptFromTransaction({ digest, poolId, principalMist, direction: "created" });
        await handleStakeEvent({ evmAddress: staker, amount: toStakeUnits(principalMist, 9),
          txHash: digest, blockNumber: checkpoint!, chain: "sui", validatorShare: poolId,
          validatorAddress: validator, suiStakedObjectId: receiptId });
      } else {
        const candidate = await prisma.stakingPosition.findFirst({ where: {
          chain: "sui", evmAddress: staker.toLowerCase(),
          validatorAddress: { equals: validator, mode: "insensitive" },
          validatorShare: { equals: poolId, mode: "insensitive" },
          status: { in: ["Bonded", "Unbonding"] },
        } });
        if (!candidate) continue;
        const receiptId = await suiReceiptFromTransaction({ digest, poolId, principalMist, direction: "deleted" });
        if (candidate.suiStakedObjectId?.toLowerCase() !== receiptId.toLowerCase()) continue;
        await handleSuiUnstake({ staker, validator, poolId, principalMist,
          receiptId, digest, checkpoint: checkpoint!, timestamp });
      }
    }
    if (edges.length > 0) {
      const last = edges[edges.length - 1]!.cursor;
      const key = `sui:graphql:${config.networkMode}:${type}`;
      await prisma.watcherCursor.upsert({ where: { key },
        create: { key, lastScannedBlock: last }, update: { lastScannedBlock: last } });
      cursors.set(type, last);
    } else if (data.events?.pageInfo?.hasNextPage) {
      throw new Error("Sui GraphQL reported another page without an event cursor");
    }
  };
  const tick = async () => {
    try {
      await pollType(SUI_STAKE_EVENT);
      await pollType(SUI_UNSTAKE_EVENT);
      reportWatcherOk("sui");
    } catch (err) {
      console.error("[sui-watcher]", err);
      reportWatcherError("sui", err);
    } finally {
      setTimeout(() => void tick(), backoffDelayMs(watcherHealth.get("sui")?.consecutiveFailures ?? 0, 10_000));
    }
  };
  void tick();
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
  return [...watcherHealth.values()].map((watcher) => withWatcherFreshness(watcher));
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
  const raw = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return undefined;
  const [whole, fraction = ""] = raw.split(".");
  const normalizedWhole = whole!.replace(/^0+(?=\d)/, "");
  const normalizedFraction = fraction.replace(/0+$/, "");
  return normalizedFraction ? `${normalizedWhole}.${normalizedFraction}` : normalizedWhole;
}

async function findPendingRequest(
  evmAddress: string,
  amount: bigint,
  chain: string,
  validatorShare: string,
  validatorId?: number,
  eventValidatorAddress?: string,
): Promise<{ request: ActiveContract; validatorAddress: string | null; userId: string | null } | undefined> {
  const requests = await canton.activeContracts(TEMPLATES.StakingRequest);
  const normalizedAddress = normalizeWalletAddress(evmAddress);
  const intents = await prisma.stakingIntent.findMany({
    where: { requestContractId: { in: requests.map((r) => r.contractId) } },
  });
  const intentByCid = new Map(intents.map((intent) => [intent.requestContractId, intent]));

  // For EVM chains, match by address and amount
  // For Cosmos/Sui, we need special handling since addresses are different formats
  const amountDecimal = normalizeDecimal(formatEther(amount));

  const candidates = requests.flatMap((r) => {
    const arg = r.argument as {
      evmAddress?: string;
      amountPol?: string | number;
      chain?: string;
    };

    const intent = intentByCid.get(r.contractId);
    if (config.networkMode === "testnet" && config.loopStakingEnabled) {
      // A real Loop create may arrive before adoption. It carries no native
      // chain/validator proof and must never use the legacy Polygon fallback.
      const preserved = r.ledgerOrigin === "legacy" &&
        r.templateId === `${config.cantonLegacyPackageId}:CantonStake.Staking:StakingRequest` &&
        r.argument.appProvider === config.cantonLegacyProviderParty;
      const reviewed = r.ledgerOrigin !== "legacy" &&
        r.templateId === `${config.cantonPackageId}:CantonStake.Staking:StakingRequest` &&
        r.argument.appProvider === config.cantonAppProviderParty;
      if (!intent?.userId || (!preserved && !reviewed)) return [];
    }
    // Old requests have no persisted network. Retain the legacy Polygon
    // path only; accepting one on another chain could misattribute funds.
    if (intent ? intent.chain !== chain : chain !== "polygon") return [];
    if (chain === "bnb" && intent?.validatorAddress?.toLowerCase() !== validatorShare.toLowerCase()) return [];
    if (chain === "monad" && intent?.validatorAddress &&
        (validatorId === undefined || intent.validatorAddress !== String(validatorId))) return [];
    if (["cosmos", "celestia", "osmosis"].includes(chain) &&
        intent?.validatorAddress !== validatorShare) return [];
    if (chain === "aptos" &&
        canonicalAptosAddress(intent?.validatorAddress) !== canonicalAptosAddress(validatorShare)) return [];
    if (chain === "solana" &&
        (intent?.stakeAccountAddress !== validatorShare || intent.validatorAddress !== eventValidatorAddress)) return [];
    if (chain === "polkadot" && intent?.validatorAddress !== validatorShare) return [];
    if (chain === "sui" && intent?.validatorAddress?.toLowerCase() !== eventValidatorAddress?.toLowerCase()) return [];

    // For Cosmos/Sui, the evmAddress is stored as-is (bech32 or Sui address)
    const matchesAddress = sameWalletAddress(arg.evmAddress, normalizedAddress);

    return matchesAddress && normalizeDecimal(arg.amountPol) === amountDecimal
      ? [{ request: r, validatorAddress: intent?.validatorAddress ?? null, userId: intent?.userId ?? null }]
      : [];
  });
  const matches: typeof candidates = [];
  for (const candidate of candidates) {
    const intent = intentByCid.get(candidate.request.contractId);
    if (chain === "polygon" && intent?.validatorAddress) {
      const resolved = await resolveValidatorShare(intent.validatorAddress);
      if (!resolved || resolved.share.toLowerCase() !== validatorShare.toLowerCase()) continue;
    }
    matches.push(candidate);
  }
  // Prefer a chain-bound intent to a legacy Polygon request with the same
  // address and amount; the latter carries no validator or network proof.
  const bound = matches.filter((match) => intentByCid.has(match.request.contractId));
  const eligible = bound.length > 0 ? bound : matches;
  // Identical pending requests are ambiguous. Do not choose one arbitrarily.
  return eligible.length === 1 ? eligible[0] : undefined;
}

async function handleStakeEvent(event: StakingEvent): Promise<void> {
  const normalizedAddress = normalizeWalletAddress(event.evmAddress);
  console.log(
    `[${event.chain}-watcher] stake from ${event.evmAddress.slice(0, 10)}... amount=${formatEther(event.amount)} tx=${event.txHash}`
  );

  const match = await findPendingRequest(event.evmAddress, event.amount, event.chain, event.validatorShare, event.validatorId, event.validatorAddress);
  if (!match) {
    // Accept can succeed on Canton and then fail while writing its Postgres
    // mirror. The request is archived at that point, so a replay cannot find
    // it among pending requests. Recover by the tx hash recorded on the
    // intent before Accept and the proof persisted in StakingPosition.
    const intents = await prisma.stakingIntent.findMany({
      where: {
        chain: event.chain,
        evmAddress: normalizedAddress,
        acceptedTxHash: event.txHash,
      },
    });
    if (intents.length === 1) {
      const intent = intents[0]!;
      if (intent.acceptedAt) return;
      const active = await canton.activeContracts(TEMPLATES.StakingPosition);
      const recovered = active.filter((position) => {
        const arg = position.argument as {
          evmAddress?: string;
          amountPol?: string | number;
          status?: string;
          lastBondProof?: { txHash?: string; validatorShare?: string };
        };
        return arg.status === "Bonded" &&
          sameWalletAddress(arg.evmAddress, event.evmAddress) &&
          normalizeDecimal(arg.amountPol) === normalizeDecimal(formatEther(event.amount)) &&
          (event.chain === "solana" ? arg.lastBondProof?.txHash === event.txHash
            : arg.lastBondProof?.txHash?.toLowerCase() === event.txHash.toLowerCase()) &&
          (event.chain === "solana" ? arg.lastBondProof?.validatorShare === event.validatorShare
            : arg.lastBondProof?.validatorShare?.toLowerCase() === event.validatorShare.toLowerCase());
      });
      if (recovered.length !== 1) {
        throw new Error(`Cannot reconcile accepted ${event.chain} stake ${event.txHash}: ${recovered.length} matching Canton positions`);
      }
      const position = recovered[0]!;
      const user = intent.userId
        ? await prisma.user.findUnique({ where: { id: intent.userId } })
        : await prisma.user.findFirst({ where: { evmAddress: normalizedAddress } });
      if (!user) throw new Error(`Cannot reconcile accepted stake ${event.txHash}: user missing`);
      await prisma.stakingPosition.upsert({
        where: { contractId: position.contractId },
        update: {
          status: "Bonded", evmTxHash: event.txHash, chain: event.chain,
          validatorAddress: intent.validatorAddress,
          validatorShare: event.validatorShare,
          validatorId: event.validatorId,
          amountShares: event.shares?.toString(),
          suiStakedObjectId: event.suiStakedObjectId,
        },
        create: {
          contractId: position.contractId,
          userId: user.id,
          evmAddress: normalizedAddress,
          amountPol: intent.amountPol,
          status: "Bonded",
          evmTxHash: event.txHash,
          chain: event.chain,
          validatorAddress: intent.validatorAddress,
          validatorShare: event.validatorShare,
          validatorId: event.validatorId,
          amountShares: event.shares?.toString(),
          suiStakedObjectId: event.suiStakedObjectId,
        },
      });
      await prisma.stakingIntent.update({
        where: { requestContractId: intent.requestContractId },
        data: { acceptedAt: new Date() },
      });
      console.log(`  -> recovered accepted ${event.chain} position ${position.contractId}`);
      return;
    }
    console.warn(
      `  no matching pending StakingRequest for ${event.evmAddress.slice(0, 10)}... / ${formatEther(event.amount)}`
    );
    return;
  }
  const { request: req } = match;

  try {
    const observed = await prisma.stakingIntent.updateMany({
      where: { requestContractId: req.contractId },
      data: { acceptedTxHash: event.txHash },
    });
    if (observed.count !== 1) {
      if (event.chain !== "polygon") {
        throw new Error(`Missing chain-bound staking intent for ${req.contractId}`);
      }
      // Legacy Polygon requests predate StakingIntent. Bind them before the
      // consuming Canton choice too, so an Accept/mirror partial failure can
      // be recovered by this transaction's proof on replay.
      const requestAmount = (req.argument as { amountPol?: string | number }).amountPol;
      await prisma.stakingIntent.upsert({
        where: { requestContractId: req.contractId },
        update: { acceptedTxHash: event.txHash },
        create: {
          requestContractId: req.contractId,
          chain: "polygon",
          validatorAddress: null,
          evmAddress: event.evmAddress.toLowerCase(),
          amountPol: requestAmount === undefined ? formatEther(event.amount) : String(requestAmount),
          acceptedTxHash: event.txHash,
        },
      });
    }
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

    // Never mirror under a fabricated CID: then /api/positions cannot join
    // the real Canton contract to its chain/validator metadata.
    const newPositionCid = extractCreatedContractId(result.events);
    if (!newPositionCid) {
      throw new Error("Canton accepted the stake but returned no StakingPosition contract ID");
    }

    // Per-validator staking metadata. Every downstream read (reward sweep,
    // unbond claimability, portfolio) needs to know WHICH ValidatorShare this
    // position lives on, because there is no global one.
    const validatorFields = {
      chain: event.chain,
      ...(match.validatorAddress ? { validatorAddress: match.validatorAddress } : {}),
      ...(event.validatorShare ? { validatorShare: event.validatorShare } : {}),
      ...(event.validatorId !== undefined ? { validatorId: event.validatorId } : {}),
      ...(event.shares !== undefined ? { amountShares: event.shares.toString() } : {}),
      ...(event.suiStakedObjectId ? { suiStakedObjectId: event.suiStakedObjectId } : {}),
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
        userId: match.userId || (await prisma.user.findFirst({
          where: { evmAddress: normalizedAddress },
        }))?.id || "",
        evmAddress: normalizedAddress,
        amountPol: reqArg.amountPol || formatEther(event.amount),
        status: "Bonded",
        evmTxHash: event.txHash,
        cantonTxId: result.transactionId,
        ...validatorFields,
      },
    });
    await prisma.stakingIntent.updateMany({
      where: { requestContractId: req.contractId },
      data: { acceptedAt: new Date(), acceptedTxHash: event.txHash },
    });
    console.log(`  -> mirrored Bonded position to Postgres`);
    await recordStakeEvent({
      positionContractId: newPositionCid,
      eventKind: "Bond",
      txProof: {
        txHash: event.txHash,
        blockNumber: event.blockNumber,
        validatorShare: event.validatorShare,
      },
      occurredAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error(`  failed to accept StakingRequest:`, err);
    throw err;
  }
}

// === Start all watchers ===

export async function startMultichainWatchers(): Promise<void> {
  console.log("[orchestrator] starting multichain event watchers...");

  // The wall only controls NEW stakes. Existing positions still need their
  // native unbond/claim watcher, and pending requests still need settlement.
  // Read these before launching watchers; if the DB is unavailable, fail
  // startup instead of silently omitting lifecycle observers.
  const [pendingIntents, livePositions] = await Promise.all([
    prisma.stakingIntent.findMany({ where: { acceptedAt: null }, select: { chain: true } }),
    prisma.stakingPosition.findMany({ where: { status: { in: ["Bonded", "Unbonding"] } }, select: { chain: true } }),
  ]);
  const requiredChains = watcherChainsForLifecycle(
    config.enabledChains,
    pendingIntents.map((row) => row.chain),
    livePositions.map((row) => row.chain),
  );
  const isRequired = (chain: string) => requiredChains.has(chain);
  const activeWatchers: Array<() => Promise<void>> = [];

  // Start each chain watcher
  if (isRequired("polygon")) activeWatchers.push(watchPolygon);
  if (isRequired("monad")) activeWatchers.push(watchMonad);
  for (const net of COSMOS_NETWORKS) {
    if (isRequired(net.chain)) activeWatchers.push(() => watchCosmosChain(net));
  }
  if (isRequired("sui")) activeWatchers.push(watchSui);
  if (isRequired("aptos")) activeWatchers.push(watchAptos);
  if (isRequired("bnb")) activeWatchers.push(watchBnb);
  if (isRequired("solana")) activeWatchers.push(watchSolana);
  if (isRequired("polkadot")) activeWatchers.push(watchPolkadotAssetHub);

  // Fire and forget - each watcher starts its own polling loop
  for (const watcher of activeWatchers) {
    watcher().catch((err) => console.error("watcher failed:", err));
  }

  console.log(`[orchestrator] ${activeWatchers.length} chain watchers started`);
}

// Backwards-compatible export for the existing orchestrator.ts
export { findPendingRequest };
