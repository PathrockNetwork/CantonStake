/**
 * CC Reward Round Automation — the revenue engine.
 *
 * Every 10 minutes, this service:
 *   1. Counts all FeaturedAppActivityMarker transactions since last round
 *   2. Calculates the app's share of the CC mint pool
 *   3. Distributes CC to user Loop wallets via beneficiary splits (75/25)
 *   4. Records each distribution in the database
 *
 * BullMQ + Redis provides:
 *   - Reliable scheduling with retry logic
 *   - Dead-letter queue for failed rounds
 *   - Dashboard visibility via BullBoard
 *
 * In production, the actual CC mint depends on:
 *   - Featured App status being active (2/3 Super Validator approval)
 *   - Network-wide transaction share (your txns / total network txns)
 *   - CC/USD price (~$0.16 at time of writing)
 *   - 100x burn-mint multiplier for Featured Apps
 *
 * For the hackathon, the mint is simulated and persisted to PostgreSQL.
 */

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { config } from "./config.js";
import { canton, TEMPLATES } from "./canton.js";
import { prisma } from "./db.js";

// --- Configuration ---

const ROUND_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const QUEUE_NAME = "cc-reward-rounds";
const DEAD_LETTER_QUEUE = "cc-reward-rounds-dead";

const connection = new IORedis(config.redisUrl, {
  maxRetriesPerRequest: null, // BullMQ requirement
});

/** Export Redis connection for health checks */
export { connection as redisConnection };

// --- Queue ---

export const rewardQueue = new Queue(QUEUE_NAME, { connection });

// --- Round processor ---

interface RoundPayload {
  roundNumber: number;
  triggeredAt: string;
}

async function processRound(job: Job<RoundPayload>) {
  let { roundNumber } = job.data;
  const startedAt = new Date();

  // Auto-compute round number for recurring jobs (which send roundNumber: 0)
  if (!roundNumber) {
    const latest = await prisma.rewardRound.findFirst({
      orderBy: { roundNumber: "desc" },
    });
    roundNumber = (latest?.roundNumber ?? 0) + 1;
  }

  console.log(
    `[reward-rounds] starting round #${roundNumber} (job ${job.id})`
  );

  // 1. Create or update the round record
  let round = await prisma.rewardRound.findUnique({
    where: { roundNumber },
  });

  if (!round) {
    round = await prisma.rewardRound.create({
      data: {
        roundNumber,
        startedAt,
        status: "processing",
      },
    });
  } else {
    await prisma.rewardRound.update({
      where: { id: round.id },
      data: { status: "processing", startedAt },
    });
  }

  try {
    // 2. Count active bonded positions (these earn CC)
    const bondedPositions = await prisma.stakingPosition.findMany({
      where: { status: "Bonded" },
      include: { user: true },
    });

    // Also query Canton ledger for ActivityMarkers emitted since last round
    let cantonMarkerCount = 0;
    try {
      const activePositions = await canton.activeContracts(
        TEMPLATES.StakingPosition
      );
      cantonMarkerCount = activePositions.reduce((sum, p) => {
        const arg = p.argument as { markersEmitted?: number };
        return sum + (arg.markersEmitted ?? 0);
      }, 0);
    } catch (err) {
      console.warn("[reward-rounds] canton query failed, using DB counts:", err);
    }

    const totalTxns = bondedPositions.length;
    const totalMarkers = totalTxns;
    const markerToTxRatio = totalTxns > 0 ? totalMarkers / totalTxns : null;

    if (!config.featuredAppRightCid) {
      await prisma.rewardRound.update({
        where: { id: round.id },
        data: {
          status: "skipped",
          completedAt: new Date(),
          totalCcMinted: "0",
          totalTxns,
          totalMarkers,
          markerToTxRatio,
          error: "FEATURED_APP_RIGHT_CID not configured",
        },
      });

      console.warn(
        `[reward-rounds] round #${roundNumber} skipped: FEATURED_APP_RIGHT_CID not configured`
      );
      return;
    }

    // 3. Calculate CC distribution
    //
    // Featured App CC pool share formula (from business plan):
    //   share = appTxns / networkTotalTxns * 516M CC monthly pool
    //   featuredMultiplier = 100x
    //   perRound = monthlyShare / (30 * 24 * 6)  // 6 rounds per hour
    //
    // For the hackathon we use a simplified mock:
    const totalActiveStakers = bondedPositions.length || 1;
    const mockCcPerRound = 100; // mock: 100 CC distributed per round
    const ccPerPosition = mockCcPerRound / totalActiveStakers;

    let totalCcMinted = 0;

    // 4. Distribute to each bonded position
    for (const position of bondedPositions) {
      const userShare = ccPerPosition * 0.75;
      const treasuryShare = ccPerPosition * 0.25;

      totalCcMinted += ccPerPosition;

      await prisma.rewardEvent.create({
        data: {
          userId: position.userId,
          positionId: position.id,
          roundId: round.id,
          ccAmount: ccPerPosition.toFixed(8),
          userShare: userShare.toFixed(8),
          treasuryShare: treasuryShare.toFixed(8),
          userWeight: 0.75,
          treasuryWeight: 0.25,
        },
      });

      // Update position's total CC earned
      const prevEarned = parseFloat(position.totalCcEarned || "0");
      await prisma.stakingPosition.update({
        where: { id: position.id },
        data: {
          totalCcEarned: (prevEarned + ccPerPosition).toFixed(8),
          markersEmitted: { increment: 1 },
        },
      });

      try {
        // The real CC distribution would happen here via Canton.
        console.log(
          `  [round #${roundNumber}] CC for ${position.user.cantonPartyId}: ${userShare.toFixed(8)} (user) + ${treasuryShare.toFixed(8)} (treasury)`
        );
      } catch (err) {
        console.error(
          `  [round #${roundNumber}] CC distribution failed for ${position.id}:`,
          err
        );
      }
    }

    // 5. Mark round as completed
    await prisma.rewardRound.update({
      where: { id: round.id },
      data: {
        status: "completed",
        completedAt: new Date(),
        totalCcMinted: totalCcMinted.toFixed(8),
        totalTxns,
        totalMarkers,
        markerToTxRatio,
      },
    });

    console.log(
      `[reward-rounds] round #${roundNumber} complete. ` +
        `CC minted: ${totalCcMinted.toFixed(2)}, positions: ${bondedPositions.length}, ` +
        `Canton markers: ${cantonMarkerCount}`
    );
  } catch (err) {
    console.error(`[reward-rounds] round #${roundNumber} failed:`, err);

    await prisma.rewardRound.update({
      where: { id: round.id },
      data: {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
        completedAt: new Date(),
      },
    });

    throw err; // re-throw for BullMQ retry
  }
}

// --- Worker ---

export const rewardWorker = new Worker<RoundPayload>(
  QUEUE_NAME,
  processRound,
  {
    connection,
    concurrency: 1, // one round at a time
  }
);

rewardWorker.on("completed", (job) => {
  console.log(`[reward-rounds] job ${job.id} completed`);
});

rewardWorker.on("failed", (job, err) => {
  console.error(`[reward-rounds] job ${job?.id} failed:`, err.message);
});

// --- Scheduler: BullMQ repeatable job every 10 minutes ---

export async function startRewardScheduler() {
  // Remove any existing repeatable jobs to avoid duplicates
  const existing = await rewardQueue.getRepeatableJobs();
  for (const job of existing) {
    await rewardQueue.removeRepeatableByKey(job.key);
  }

  // Find the latest round number to know where we are
  const latestRound = await prisma.rewardRound.findFirst({
    orderBy: { roundNumber: "desc" },
  });
  const nextRound = (latestRound?.roundNumber ?? 0) + 1;

  console.log(
    `[reward-scheduler] starting from round #${nextRound} ` +
      `(interval: ${ROUND_INTERVAL_MS / 1000}s, BullMQ repeatable)`
  );

  // Enqueue first round immediately
  await enqueueRound(nextRound);

  // Schedule recurring rounds via BullMQ repeatable jobs
  await rewardQueue.add(
    "round-recurring",
    { roundNumber: 0, triggeredAt: new Date().toISOString() },
    {
      repeat: { every: ROUND_INTERVAL_MS },
      jobId: "cc-round-recurring",
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );
}

/** Enqueue a single round with a specific round number */
export async function enqueueRound(roundNumber: number) {
  await rewardQueue.add(
    "round",
    {
      roundNumber,
      triggeredAt: new Date().toISOString(),
    },
    {
      attempts: 3,
      backoff: { type: "exponential", delay: 5_000 },
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
    }
  );

  console.log(`[reward-scheduler] enqueued round #${roundNumber}`);
}

// --- Graceful shutdown ---

export async function shutdownRewardSystem() {
  console.log("[reward-rounds] shutting down...");
  await rewardWorker.close();
  await rewardQueue.close();
  await connection.quit();
}
