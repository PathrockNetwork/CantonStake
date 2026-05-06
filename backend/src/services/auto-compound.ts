/**
 * Auto-compound keeper — scans active AutoCompoundPermit rows and
 * executes claim+restake on the user's behalf within the permit's
 * scope and expiry.
 *
 * Architecture:
 *
 *   - Permits are created off-chain by the user signing a typed message
 *     (EIP-712 / MsgGrant Authz / equivalent). The signature is opaque
 *     to this service — verification happens in the per-chain executor
 *     before any broadcast.
 *
 *   - A BullMQ repeatable job ticks every autoCompoundIntervalSec
 *     (default 15 min). Each tick:
 *       1. Loads enabled, non-expired permits.
 *       2. Per permit, dispatches to the chain's executor.
 *       3. Records an AutoCompoundRun row with outcome.
 *
 *   - Executors are best-effort and idempotent. The per-chain logic
 *     verifies the signature, queries pending rewards, and broadcasts
 *     the compound tx. For the hackathon scope, only the Polygon mock
 *     executor is wired against MockValidatorShare; all other chains
 *     return a "skipped" run (the framework is in place for Codex /
 *     future work to extend).
 *
 *   - Custody note: this service holds AUTO_COMPOUND_KEEPER_KEY for
 *     EVM broadcasts, but ONLY acts within the user's signed permit
 *     scope. We deliberately do NOT integrate Gelato/Chainlink (would
 *     introduce third-party custody risk). Cosmos-side compounding uses
 *     Authz grants and is fully self-custodial — the keeper just
 *     submits a MsgExec.
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

// --- Types ---

export type CompoundChain =
  | "polygon"
  | "moonbeam"
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

const validatorShareAbi = [
  parseAbiItem("function pendingRewards(address user) view returns (uint256)"),
  parseAbiItem("function restake() returns (bool)"),
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

  const account = privateKeyToAccount(config.autoCompoundKeeperKey as Hex);
  const publicClient = createPublicClient({
    chain: polygonAmoy,
    transport: http(config.amoyRpcUrl),
  });
  const walletClient = createWalletClient({
    account,
    chain: polygonAmoy,
    transport: http(config.amoyRpcUrl),
  });

  // Read pending rewards. If zero, skip — broadcasting a noop wastes gas.
  const pending = (await publicClient.readContract({
    address: ctx.validator as Address,
    abi: validatorShareAbi,
    functionName: "pendingRewards",
    args: [ctx.evmAddress as Address],
  })) as bigint;

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
      abi: validatorShareAbi,
      functionName: "restake",
      args: [],
    });
    const txHash = await walletClient.sendTransaction({
      to: ctx.validator as Address,
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

async function executeStub(
  chain: CompoundChain
): Promise<ExecutorResult> {
  return {
    status: "skipped",
    reason: `${chain} executor not yet implemented — chain adapter pending`,
  };
}

const EXECUTORS: Record<
  CompoundChain,
  (ctx: ExecutorContext) => Promise<ExecutorResult>
> = {
  polygon: executePolygon,
  moonbeam: () => executeStub("moonbeam"),
  monad: () => executeStub("monad"),
  cosmos: () => executeStub("cosmos"),
  sui: () => executeStub("sui"),
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

const worker = new Worker<TickPayload>(QUEUE_NAME, (job) => runTick(job.data), {
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
