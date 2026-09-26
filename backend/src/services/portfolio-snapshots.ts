/**
 * Portfolio TVL snapshot cron — writes a TvlSnapshot row at the
 * portfolioSnapshotIntervalSec cadence so the analytics chart has a
 * proper time series instead of a synthesised one.
 *
 * Scope: snapshots every wallet address recorded for a user, including
 * native-chain addresses that are no longer the user's latest address.
 * Rate-limited by the portfolio cache (60 s default), so a 5-minute
 * snapshot cadence with N users does at most 1 RPC fetch per chain
 * per 60 s anyway — Redis absorbs the duplicate calls.
 */

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";
import { prisma } from "../db.js";
import { getPortfolio } from "./portfolio-cache.js";
import { validPortfolioAddress } from "./portfolio-recorded.js";

const QUEUE_NAME = "portfolio-snapshots";
const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(QUEUE_NAME, { connection: redis });

interface SnapshotPayload {
  reason: "cron" | "manual";
}

async function runSnapshotTick(_payload: SnapshotPayload): Promise<void> {
  // Testnet faucet assets have no market value. Do not persist a synthetic
  // USD TVL based on their namesake mainnet symbols.
  if (config.networkMode !== "mainnet") return;
  const users = await prisma.user.findMany({
    where: { OR: [{ evmAddress: { not: null } }, { positions: { some: {} } }] },
    include: { positions: { select: { evmAddress: true } } },
  });
  if (users.length === 0) {
    console.log("[portfolio-snapshots] no users with wallet positions — skipping");
    return;
  }

  let written = 0;
  for (const user of users) {
    const addresses = [...new Set([user.evmAddress, ...user.positions.map((p) => p.evmAddress)]
      .filter((address): address is string => !!address && validPortfolioAddress(address)))];
    for (const address of addresses) {
      try {
        const snap = await getPortfolio(address);
        if (snap.totalUsd === null) continue;
        const perChain: Record<string, number> = {};
        for (const d of snap.delegations) {
          perChain[d.chain] = (perChain[d.chain] ?? 0) + Number(d.amount);
        }
        await prisma.tvlSnapshot.create({
          data: {
            userId: user.id,
            evmAddress: address,
            totalUsd: snap.totalUsd,
            perChain,
          },
        });
        written += 1;
      } catch (err) {
        console.warn(`[portfolio-snapshots] user=${user.id} address=${address} snapshot failed:`, err);
      }
    }
  }
  console.log(`[portfolio-snapshots] tick wrote ${written} wallet rows for ${users.length} users`);
}

const worker = new Worker<SnapshotPayload>(
  QUEUE_NAME,
  (job) => runSnapshotTick(job.data),
  {
  connection: redis,
  concurrency: 1,
  }
);

worker.on("failed", (job, err) => {
  console.warn(`[portfolio-snapshots] job ${job?.id} failed:`, err.message);
});

export async function startPortfolioSnapshotScheduler(): Promise<void> {
  if (config.portfolioSnapshotsDisabled || config.networkMode !== "mainnet") {
    console.log("[portfolio-snapshots] disabled via PORTFOLIO_SNAPSHOTS_DISABLED");
    return;
  }
  // Idempotent: clear existing repeatables before re-scheduling.
  const existing = await queue.getRepeatableJobs();
  for (const j of existing) await queue.removeRepeatableByKey(j.key);

  await queue.add(
    "snapshot-tick",
    { reason: "cron" },
    {
      jobId: "portfolio-snapshot-recurring",
      repeat: { every: config.portfolioSnapshotIntervalSec * 1000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );
  console.log(
    `[portfolio-snapshots] scheduler started (every ${config.portfolioSnapshotIntervalSec}s)`
  );
}

export async function shutdownPortfolioSnapshots(): Promise<void> {
  await worker.close();
  await queue.close();
  await redis.quit();
}
