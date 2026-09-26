/**
 * Experimental auto-compound keeper scaffolding. Scheduled and manual
 * execution are blocked while AUTO_COMPOUND_DISABLED=true (the default).
 *
 * When enabled, a BullMQ tick loads enabled, non-expired permit rows,
 * dispatches executors, and records their outcomes. Stored signatures
 * are NOT cryptographically verified by these executors. Expiry/cap
 * checks do not establish authorization over a user's native delegation;
 * wallet-owned execution and Cosmos Authz integration remain unfinished.
 * Keep this disabled and do not provision/fund keeper keys as a substitute
 * for implementing verified per-chain authorization and lifecycle tests.
 */

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  parseAbiItem,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { polygonAmoy } from "viem/chains";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { runAutoCompoundTickIfEnabled } from "./auto-compound-gate.js";
import {
  getLiquidRewards,
  resolveValidatorShare,
  settlementChainDef,
} from "./validator-share.js";

// --- Types ---

export type CompoundChain =
  | "polygon"
  | "monad"
  | "cosmos"
  | "sui";

interface ExecutorContext {
  permitId: string;
  userId: string;
  chain: CompoundChain;
  validator: string;
  signature: string | null;
  signaturePayload: string | null;
  maxPerRun: string | null;
  evmAddress: string | null;
}

interface ExecutorResult {
  status: "success" | "failed" | "skipped";
  reason?: string;
  amountClaimed?: string;
  amountRestaked?: string;
  txHash?: string;
}

// --- Redis + queue ---

const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const QUEUE_NAME = "auto-compound";
const queue = new Queue(QUEUE_NAME, { connection: redis });

// --- Polygon executor (the only live implementation) ---

// Real ValidatorShare surface. `getLiquidRewards` is the delegator's share
// of checkpoint-distributed protocol yield — the mock's `pendingRewards`
// (a simulated APR paid from a pre-funded balance) does not exist here, and
// `restake()` returns (amountRestaked, totalStaked), not a bool.
const compoundValidatorShareAbi = [
  parseAbiItem("function getLiquidRewards(address user) view returns (uint256)"),
  parseAbiItem("function restake() returns (uint256, uint256)"),
] as const;

async function executePolygon(
  ctx: ExecutorContext
): Promise<ExecutorResult> {
  if (!config.autoCompoundKeeperKey) {
    return { status: "skipped", reason: "AUTO_COMPOUND_KEEPER_KEY unset" };
  }
  if (!ctx.evmAddress) {
    return { status: "skipped", reason: "user has no EVM address on file" };
  }

  // The permit records the validator's SIGNER address; the contract to call
  // is that validator's own ValidatorShare, resolved off the StakeManager.
  const resolved = await resolveValidatorShare(ctx.validator);
  if (!resolved) {
    return {
      status: "skipped",
      reason: `no ValidatorShare registered for validator ${ctx.validator}`,
    };
  }

  const account = privateKeyToAccount(config.autoCompoundKeeperKey as Hex);
  const walletClient = createWalletClient({
    account,
    chain: settlementChainDef,
    transport: http(config.stakeSettlementRpcUrl),
  });

  // Read claimable protocol yield. If zero, skip — a noop wastes gas.
  const pending = await getLiquidRewards(
    resolved.share,
    ctx.evmAddress as Address
  );

  if (pending === 0n) {
    return { status: "skipped", reason: "no pending rewards" };
  }

  // Optional per-run cap: skip if pending exceeds the user's bound.
  if (ctx.maxPerRun) {
    try {
      const cap = BigInt(ctx.maxPerRun);
      if (pending > cap) {
        return {
          status: "skipped",
          reason: `pending ${pending.toString()} exceeds maxPerRun ${cap.toString()}`,
        };
      }
    } catch {
      // ignore parse errors — treat as no cap
    }
  }

  try {
    const data = encodeFunctionData({
      abi: compoundValidatorShareAbi,
      functionName: "restake",
      args: [],
    });
    const txHash = await walletClient.sendTransaction({
      to: resolved.share,
      data,
    });
    return {
      status: "success",
      amountClaimed: pending.toString(),
      amountRestaked: pending.toString(),
      txHash,
    };
  } catch (err) {
    return { status: "failed", reason: String(err) };
  }
}

// --- Monad executor (staking precompile at 0x...1000 via viem) ---

const monadStakingAbi = [
  parseAbiItem("function compound(uint64 validator_id)"),
  parseAbiItem(
    "function get_delegator(uint64 validator_id, address delegator) view returns (uint256, uint256, uint256, uint256, uint256, uint64, uint64)"
  ),
] as const;

async function executeMonad(
  ctx: ExecutorContext
): Promise<ExecutorResult> {
  if (!config.autoCompoundKeeperKey) {
    return { status: "skipped", reason: "AUTO_COMPOUND_KEEPER_KEY unset" };
  }
  if (!ctx.evmAddress) {
    return { status: "skipped", reason: "user has no EVM address on file" };
  }

  let valId: bigint;
  try {
    valId = BigInt(ctx.validator);
  } catch {
    return {
      status: "skipped",
      reason: `monad validator must be a numeric id (got ${ctx.validator})`,
    };
  }

  const monadChainId = 10143; // Monad testnet — adjust for mainnet when published.
  const account = privateKeyToAccount(config.autoCompoundKeeperKey as Hex);
  const monadChain = {
    id: monadChainId,
    name: "Monad",
    nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
    rpcUrls: { default: { http: [config.monadRpcUrl] } },
  } as const;
  const walletClient = createWalletClient({
    account,
    chain: monadChain,
    transport: http(config.monadRpcUrl),
  });

  const stakingContract =
    (config.monadStakingContract ||
      "0x0000000000000000000000000000000000001000") as Address;

  try {
    const data = encodeFunctionData({
      abi: monadStakingAbi,
      functionName: "compound",
      args: [valId],
    });
    const txHash = await walletClient.sendTransaction({
      to: stakingContract,
      data,
    });
    return {
      status: "success",
      txHash,
    };
  } catch (err) {
    return { status: "failed", reason: String(err) };
  }
}

// --- Cosmos executor (Authz MsgExec → MsgWithdrawDelegatorReward + MsgDelegate) ---

async function executeCosmos(
  ctx: ExecutorContext
): Promise<ExecutorResult> {
  if (!config.cosmosKeeperMnemonic) {
    return {
      status: "skipped",
      reason: "COSMOS_KEEPER_MNEMONIC unset",
    };
  }

  // Lazy-load to avoid pulling cosmjs into the import graph at startup
  // (it's a sizeable bundle — better to only initialise when a permit
  // actually exists).
  const { DirectSecp256k1HdWallet } = await import("@cosmjs/proto-signing");
  const { SigningStargateClient, GasPrice } = await import(
    "@cosmjs/stargate"
  );
  const { MsgWithdrawDelegatorReward } = await import(
    "cosmjs-types/cosmos/distribution/v1beta1/tx"
  );
  const { MsgDelegate } = await import(
    "cosmjs-types/cosmos/staking/v1beta1/tx"
  );
  const { MsgExec } = await import("cosmjs-types/cosmos/authz/v1beta1/tx");

  const wallet = await DirectSecp256k1HdWallet.fromMnemonic(
    config.cosmosKeeperMnemonic,
    { prefix: config.cosmosKeeperPrefix }
  );
  const [keeperAccount] = await wallet.getAccounts();
  if (!keeperAccount) {
    return { status: "failed", reason: "cosmos keeper has no accounts" };
  }

  const client = await SigningStargateClient.connectWithSigner(
    config.cosmosRpcUrl,
    wallet,
    { gasPrice: GasPrice.fromString(config.cosmosGasPrice) }
  );

  // Granter = the delegator party; we expect this on the user model. The
  // permit's `signaturePayload` carries the granter address (Cosmos addrs
  // aren't EVM addresses, so we reuse signaturePayload for chain-native
  // metadata).
  const granter = ctx.signaturePayload;
  if (!granter) {
    return {
      status: "skipped",
      reason: "permit.signaturePayload missing cosmos granter address",
    };
  }

  const claimMsg = {
    typeUrl: "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward",
    value: MsgWithdrawDelegatorReward.fromPartial({
      delegatorAddress: granter,
      validatorAddress: ctx.validator,
    }),
  };
  // Without a balance probe we restake whatever the user has authorised
  // via maxPerRun. Falling back to a nominal 1uatom is wrong; require a cap.
  if (!ctx.maxPerRun) {
    return {
      status: "skipped",
      reason: "cosmos compound requires a non-zero maxPerRun cap (uatom)",
    };
  }
  const delegateMsg = {
    typeUrl: "/cosmos.staking.v1beta1.MsgDelegate",
    value: MsgDelegate.fromPartial({
      delegatorAddress: granter,
      validatorAddress: ctx.validator,
      amount: { denom: "uatom", amount: ctx.maxPerRun },
    }),
  };
  const exec = {
    typeUrl: "/cosmos.authz.v1beta1.MsgExec",
    value: MsgExec.fromPartial({
      grantee: keeperAccount.address,
      msgs: [claimMsg, delegateMsg].map((m) => ({
        typeUrl: m.typeUrl,
        value:
          m.typeUrl ===
          "/cosmos.distribution.v1beta1.MsgWithdrawDelegatorReward"
            ? MsgWithdrawDelegatorReward.encode(m.value as never).finish()
            : MsgDelegate.encode(m.value as never).finish(),
      })),
    }),
  };

  try {
    const result = await client.signAndBroadcast(
      keeperAccount.address,
      [exec],
      "auto",
      "cantonstake auto-compound"
    );
    if (result.code !== 0) {
      return {
        status: "failed",
        reason: `cosmos broadcast code=${result.code} log=${result.rawLog ?? ""}`,
      };
    }
    return {
      status: "success",
      amountRestaked: ctx.maxPerRun,
      txHash: result.transactionHash,
    };
  } catch (err) {
    return { status: "failed", reason: String(err) };
  } finally {
    client.disconnect();
  }
}

// --- Sui executor (request_add_stake using the keeper's keypair) ---

async function executeSui(
  ctx: ExecutorContext
): Promise<ExecutorResult> {
  if (!config.suiKeeperPrivateKey) {
    return {
      status: "skipped",
      reason: "SUI_KEEPER_PRIVATE_KEY unset",
    };
  }
  if (!ctx.maxPerRun) {
    return {
      status: "skipped",
      reason: "sui compound requires a non-zero maxPerRun cap (mist)",
    };
  }

  const { SuiGraphQLClient } = await import("@mysten/sui/graphql");
  const { Transaction } = await import("@mysten/sui/transactions");
  const { Ed25519Keypair } = await import("@mysten/sui/keypairs/ed25519");

  const keypair = Ed25519Keypair.fromSecretKey(config.suiKeeperPrivateKey);
  const client = new SuiGraphQLClient({
    url: config.suiGraphqlUrl,
    network: config.networkMode,
  });

  try {
    const tx = new Transaction();
    const [stakeCoin] = tx.splitCoins(tx.gas, [BigInt(ctx.maxPerRun)]);
    tx.moveCall({
      target: "0x3::sui_system::request_add_stake",
      arguments: [
        tx.object("0x5"),
        stakeCoin!,
        tx.pure.address(ctx.validator),
      ],
    });
    const result = await client.signAndExecuteTransaction({ transaction: tx, signer: keypair });
    if (result.$kind !== "Transaction") throw new Error("Sui keeper stake transaction failed");
    return {
      status: "success",
      amountRestaked: ctx.maxPerRun,
      txHash: result.Transaction.digest,
    };
  } catch (err) {
    return { status: "failed", reason: String(err) };
  }
}

const EXECUTORS: Record<
  CompoundChain,
  (ctx: ExecutorContext) => Promise<ExecutorResult>
> = {
  polygon: executePolygon,
  monad: executeMonad,
  cosmos: executeCosmos,
  sui: executeSui,
};

// --- Tick: scan permits, dispatch executors, record runs ---

interface TickPayload {
  reason: "cron" | "manual";
}

async function runTick(_payload: TickPayload): Promise<void> {
  const now = new Date();
  const permits = await prisma.autoCompoundPermit.findMany({
    where: { enabled: true, expiresAt: { gt: now } },
    include: { user: true },
  });
  if (permits.length === 0) {
    console.log("[auto-compound] tick: no active permits");
    return;
  }

  console.log(`[auto-compound] tick: ${permits.length} active permits`);

  for (const permit of permits) {
    const run = await prisma.autoCompoundRun.create({
      data: { permitId: permit.id, status: "skipped" },
    });

    let result: ExecutorResult;
    try {
      const exec = EXECUTORS[permit.chain as CompoundChain];
      if (!exec) {
        result = {
          status: "skipped",
          reason: `unknown chain: ${permit.chain}`,
        };
      } else {
        result = await exec({
          permitId: permit.id,
          userId: permit.userId,
          chain: permit.chain as CompoundChain,
          validator: permit.validator,
          signature: permit.signature,
          signaturePayload: permit.signaturePayload,
          maxPerRun: permit.maxPerRun,
          evmAddress: permit.user.evmAddress,
        });
      }
    } catch (err) {
      result = { status: "failed", reason: String(err) };
    }

    await prisma.autoCompoundRun.update({
      where: { id: run.id },
      data: {
        status: result.status,
        reason: result.reason ?? null,
        amountClaimed: result.amountClaimed ?? null,
        amountRestaked: result.amountRestaked ?? null,
        txHash: result.txHash ?? null,
        finishedAt: new Date(),
      },
    });
    await prisma.autoCompoundPermit.update({
      where: { id: permit.id },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: result.status,
        lastRunError: result.status === "failed" ? result.reason ?? null : null,
      },
    });
    console.log(
      `[auto-compound] permit=${permit.id} chain=${permit.chain} status=${result.status} reason=${result.reason ?? "ok"}`
    );
  }
}

// --- Worker ---

const worker = new Worker<TickPayload>(QUEUE_NAME, (job) =>
  runAutoCompoundTickIfEnabled(config.autoCompoundDisabled, () => runTick(job.data)), {
  connection: redis,
  concurrency: 1,
});

worker.on("failed", (job, err) => {
  console.warn(`[auto-compound] tick failed:`, err.message);
});

export async function startAutoCompoundScheduler(): Promise<void> {
  if (config.autoCompoundDisabled) {
    console.log("[auto-compound] disabled via AUTO_COMPOUND_DISABLED");
    return;
  }
  const existing = await queue.getRepeatableJobs();
  for (const j of existing) await queue.removeRepeatableByKey(j.key);

  await queue.add(
    "tick",
    { reason: "cron" },
    {
      jobId: "auto-compound-recurring",
      repeat: { every: config.autoCompoundIntervalSec * 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );
  console.log(
    `[auto-compound] scheduler started (every ${config.autoCompoundIntervalSec}s)`
  );
}

/** Manual trigger for demos (not recurring). */
export async function triggerAutoCompoundTick(): Promise<void> {
  if (config.autoCompoundDisabled) throw new Error("Auto-compound is disabled via AUTO_COMPOUND_DISABLED");
  await queue.add(
    "tick",
    { reason: "manual" },
    {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );
}

export async function shutdownAutoCompound(): Promise<void> {
  await worker.close();
  await queue.close();
  await redis.quit();
}
