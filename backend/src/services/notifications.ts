/**
 * Notifications fan-out — Telegram + Resend (email) + Discord webhooks.
 *
 * Architecture:
 *   1. A producer (slashing monitor, reward scheduler, etc.) calls
 *      `emitAlert()` with a kind, payload, dedupKey, and scoping.
 *   2. emitAlert upserts an AlertEvent (idempotent on dedupKey) and
 *      enqueues a BullMQ job for each enabled NotificationChannel.
 *   3. The worker dispatches per-channel via the appropriate sender.
 *      Each sender is gated on its env credential and silently no-ops
 *      when not configured.
 *   4. Each delivery attempt writes an AlertDelivery row (delivered |
 *      failed | skipped) so a partial fan-out is observable.
 *
 * Failure handling:
 *   - Retries: 3 attempts with exponential backoff per delivery job.
 *   - A persistently failing channel does NOT block other channels —
 *     each (alert, channel) pair is its own BullMQ job.
 *   - The worker never throws; it logs and writes a "failed" delivery
 *     row instead, so the queue depth stays sane.
 */

import { Queue, Worker, type Job } from "bullmq";
import IORedis from "ioredis";
import { config } from "../config.js";
import { prisma } from "../db.js";

// --- Types ---

export type AlertKind =
  | "validator.jailed"
  | "validator.unjailed"
  | "validator.score_drop"
  | "round.minted";

export interface AlertInput {
  kind: AlertKind;
  payload: Record<string, unknown>;
  dedupKey?: string;
  userId?: string;        // when set, only that user's channels receive it
  chain?: string;
  validatorAddress?: string;
}

interface DeliveryJobData {
  alertId: string;
  channelId: string;
}

// --- Redis + BullMQ ---

const redis = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
const QUEUE_NAME = "notifications";

const queue = new Queue<DeliveryJobData>(QUEUE_NAME, { connection: redis });

// --- Senders -----------------------------------------------------------------

type SendResult = { ok: true } | { ok: false; error: string };

async function sendTelegram(target: string, text: string): Promise<SendResult> {
  if (!config.telegramBotToken) {
    return { ok: false, error: "TELEGRAM_BOT_TOKEN unset" };
  }
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${config.telegramBotToken}/sendMessage`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: target,
          text,
          parse_mode: "Markdown",
          disable_web_page_preview: true,
        }),
      }
    );
    if (!res.ok) {
      return { ok: false, error: `telegram ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function sendEmail(
  target: string,
  subject: string,
  text: string
): Promise<SendResult> {
  if (!config.resendApiKey) {
    return { ok: false, error: "RESEND_API_KEY unset" };
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.resendApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: config.resendFrom,
        to: target,
        subject,
        text,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `resend ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function sendDiscord(target: string, content: string): Promise<SendResult> {
  // target can be a per-user webhook URL or "default" — fall back to
  // DISCORD_DEFAULT_WEBHOOK for the latter.
  const url =
    target === "default" || target === ""
      ? config.discordDefaultWebhook
      : target;
  if (!url) {
    return { ok: false, error: "no Discord webhook URL configured" };
  }
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content }),
    });
    if (!res.ok) {
      return { ok: false, error: `discord ${res.status}: ${await res.text()}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// --- Message templating ------------------------------------------------------

function alertSubject(kind: AlertKind, payload: Record<string, unknown>): string {
  switch (kind) {
    case "validator.jailed":
      return `🚨 ${payload.chain ?? "validator"} · ${payload.name ?? payload.validatorAddress ?? "unknown"} jailed`;
    case "validator.unjailed":
      return `✓ ${payload.chain ?? "validator"} · ${payload.name ?? payload.validatorAddress ?? "unknown"} unjailed`;
    case "validator.score_drop":
      return `⚠ ${payload.chain ?? "validator"} · score drop on ${payload.name ?? payload.validatorAddress ?? "unknown"}`;
    case "round.minted":
      return `+ CC round ${payload.roundNumber ?? "?"} minted`;
  }
}

function alertBody(kind: AlertKind, payload: Record<string, unknown>): string {
  const lines: string[] = [];
  switch (kind) {
    case "validator.jailed":
      lines.push(
        `${payload.chain} validator *${payload.name ?? payload.validatorAddress}* was just jailed.`,
        `Score: ${payload.score ?? "?"} (was ${payload.previousScore ?? "?"})`
      );
      if (payload.commissionPct != null) lines.push(`Commission: ${payload.commissionPct}%`);
      lines.push("Consider redelegating before further slashing.");
      break;
    case "validator.unjailed":
      lines.push(
        `${payload.chain} validator *${payload.name ?? payload.validatorAddress}* is back in the active set.`,
        `Score: ${payload.score ?? "?"}`
      );
      break;
    case "validator.score_drop":
      lines.push(
        `${payload.chain} validator *${payload.name ?? payload.validatorAddress}* score dropped from ${payload.previousScore} to ${payload.score} (Δ ${payload.delta}).`
      );
      if (payload.reason) lines.push(`Reason: ${payload.reason}`);
      break;
    case "round.minted":
      lines.push(
        `Round ${payload.roundNumber} attributed *${payload.userCc} CC* to your stake.`,
        `Total network share: ${payload.networkSharePct ?? "?"}%`
      );
      break;
  }
  return lines.join("\n");
}

// --- Public API --------------------------------------------------------------

/**
 * Emit an alert. Persists an AlertEvent (idempotent on dedupKey), looks
 * up the relevant NotificationChannels, and enqueues a delivery job per
 * channel. Returns the AlertEvent ID, or null if dedup'd.
 */
export async function emitAlert(input: AlertInput): Promise<string | null> {
  if (config.alertsDisabled) return null;

  // Idempotent insert via dedupKey when supplied.
  let alert;
  if (input.dedupKey) {
    const existing = await prisma.alertEvent.findUnique({
      where: { dedupKey: input.dedupKey },
    });
    if (existing) {
      console.log(`[alerts] dedup hit on ${input.dedupKey} — skipping`);
      return null;
    }
    try {
      alert = await prisma.alertEvent.create({
        data: {
          kind: input.kind,
          payload: input.payload as object,
          userId: input.userId,
          chain: input.chain,
          validatorAddress: input.validatorAddress,
          dedupKey: input.dedupKey,
        },
      });
    } catch (err) {
      // Race: another worker created the same dedupKey between our check
      // and our insert. Treat as dedup'd.
      console.log(`[alerts] dedup race on ${input.dedupKey}: ${err}`);
      return null;
    }
  } else {
    alert = await prisma.alertEvent.create({
      data: {
        kind: input.kind,
        payload: input.payload as object,
        userId: input.userId,
        chain: input.chain,
        validatorAddress: input.validatorAddress,
      },
    });
  }

  // Channel scope: when userId is set, only that user's channels.
  // Otherwise broadcast to every enabled channel (e.g. ops alerts).
  const channels = await prisma.notificationChannel.findMany({
    where: {
      enabled: true,
      ...(input.userId ? { userId: input.userId } : {}),
    },
  });

  for (const ch of channels) {
    await prisma.alertDelivery.create({
      data: { alertId: alert.id, channelId: ch.id, status: "pending" },
    });
    await queue.add(
      "deliver",
      { alertId: alert.id, channelId: ch.id },
      {
        attempts: 3,
        backoff: { type: "exponential", delay: 5_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 50 },
      }
    );
  }

  console.log(
    `[alerts] emitted ${input.kind} alertId=${alert.id} fanout=${channels.length}`
  );
  return alert.id;
}

// --- Worker ------------------------------------------------------------------

const worker = new Worker<DeliveryJobData>(
  QUEUE_NAME,
  async (job: Job<DeliveryJobData>) => {
    const { alertId, channelId } = job.data;
    const [alert, channel] = await Promise.all([
      prisma.alertEvent.findUnique({ where: { id: alertId } }),
      prisma.notificationChannel.findUnique({ where: { id: channelId } }),
    ]);
    if (!alert || !channel) {
      console.warn(`[alerts] missing alert/channel: ${alertId}/${channelId}`);
      return;
    }
    if (!channel.enabled) {
      await prisma.alertDelivery.update({
        where: { alertId_channelId: { alertId, channelId } },
        data: { status: "skipped", error: "channel disabled" },
      });
      return;
    }

    const kind = alert.kind as AlertKind;
    const payload = (alert.payload as Record<string, unknown>) ?? {};
    const subject = alertSubject(kind, payload);
    const body = `${subject}\n\n${alertBody(kind, payload)}`;

    let result: SendResult;
    switch (channel.kind) {
      case "telegram":
        result = await sendTelegram(channel.target, body);
        break;
      case "email":
        result = await sendEmail(channel.target, subject, body);
        break;
      case "discord":
        result = await sendDiscord(channel.target, body);
        break;
      default:
        result = { ok: false, error: `unknown channel kind: ${channel.kind}` };
    }

    if (result.ok) {
      await prisma.alertDelivery.update({
        where: { alertId_channelId: { alertId, channelId } },
        data: { status: "delivered", deliveredAt: new Date(), error: null },
      });
    } else {
      await prisma.alertDelivery.update({
        where: { alertId_channelId: { alertId, channelId } },
        data: { status: "failed", error: result.error.slice(0, 500) },
      });
      // Re-throw so BullMQ schedules a retry.
      throw new Error(result.error);
    }
  },
  { connection: redis, concurrency: 4 }
);

worker.on("failed", (job, err) => {
  console.warn(
    `[alerts] delivery failed alertId=${job?.data.alertId} channelId=${job?.data.channelId}: ${err.message}`
  );
});

export async function shutdownNotifications(): Promise<void> {
  await worker.close();
  await queue.close();
  await redis.quit();
}
