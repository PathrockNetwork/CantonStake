/**
 * Zero-dependency observability — Sentry error reporting + Prometheus
 * metrics endpoint.
 *
 * No new npm dependencies: we POST directly to Sentry's `/store` endpoint
 * via fetch, and emit the Prometheus exposition format ourselves. This
 * keeps the install footprint tiny and avoids version-pinning two SDKs
 * for a hackathon backend.
 *
 * Both reporters degrade safely:
 *   - When SENTRY_DSN is unset, captureException is a no-op.
 *   - The /metrics endpoint always works (counters start at 0).
 */

import { config } from "../config.js";

// --- Sentry HTTP reporter ---------------------------------------------------

interface ParsedDsn {
  publicKey: string;
  projectId: string;
  host: string;
  protocol: string;
}

function parseDsn(dsn: string): ParsedDsn | null {
  // DSN form: https://<publicKey>@<host>/<projectId>
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\/+/, "");
    if (!u.username || !projectId) return null;
    return {
      publicKey: u.username,
      projectId,
      host: u.host,
      protocol: u.protocol.replace(":", ""),
    };
  } catch {
    return null;
  }
}

const sentryDsn = config.sentryDsn ? parseDsn(config.sentryDsn) : null;
if (config.sentryDsn && !sentryDsn) {
  console.warn(
    "[observability] SENTRY_DSN set but unparseable — Sentry reporting disabled"
  );
}

interface CaptureContext {
  level?: "error" | "warning" | "info";
  tags?: Record<string, string>;
  extra?: Record<string, unknown>;
}

/**
 * Best-effort Sentry capture. Fire-and-forget — we never await the
 * upload from a hot path, and a failed send is logged + swallowed.
 */
export function captureException(
  err: unknown,
  ctx: CaptureContext = {}
): void {
  if (!sentryDsn) return;

  const error = err instanceof Error ? err : new Error(String(err));
  const event = {
    event_id: cryptoRandomId(),
    timestamp: Math.floor(Date.now() / 1000),
    platform: "node",
    level: ctx.level ?? "error",
    server_name: process.env.FLY_REGION ?? "local",
    environment: config.sentryEnv,
    release: config.sentryRelease || undefined,
    tags: ctx.tags,
    extra: ctx.extra,
    exception: {
      values: [
        {
          type: error.name,
          value: error.message,
          stacktrace: error.stack
            ? { frames: parseStack(error.stack) }
            : undefined,
        },
      ],
    },
  };

  const url = `${sentryDsn.protocol}://${sentryDsn.host}/api/${sentryDsn.projectId}/store/`;
  const auth =
    `Sentry sentry_version=7,sentry_client=cantonstake/0.0.1,` +
    `sentry_key=${sentryDsn.publicKey}`;

  void fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-sentry-auth": auth,
    },
    body: JSON.stringify(event),
  }).catch((sendErr) => {
    console.warn("[observability] Sentry send failed:", sendErr);
  });
}

function cryptoRandomId(): string {
  return Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
}

interface StackFrame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
}

function parseStack(stack: string): StackFrame[] {
  const lines = stack.split("\n").slice(1);
  const frames: StackFrame[] = [];
  for (const line of lines) {
    const m = line.match(/^\s*at\s+(?:(.+?)\s+)?\(?([^)]+):(\d+):(\d+)\)?$/);
    if (!m) continue;
    frames.push({
      function: m[1] || undefined,
      filename: m[2],
      lineno: Number(m[3]),
      colno: Number(m[4]),
    });
  }
  // Sentry expects oldest first.
  return frames.reverse();
}

// --- Prometheus counters ----------------------------------------------------

type LabelKV = Record<string, string>;

function labelKey(name: string, labels: LabelKV): string {
  const flat = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${escapeLabel(v)}"`)
    .join(",");
  return `${name}{${flat}}`;
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const counterDescriptions = new Map<string, string>();
const gaugeDescriptions = new Map<string, string>();

export function counter(
  name: string,
  help: string,
  labels: LabelKV = {},
  delta = 1
): void {
  counterDescriptions.set(name, help);
  const key = labelKey(name, labels);
  counters.set(key, (counters.get(key) ?? 0) + delta);
}

export function gauge(
  name: string,
  help: string,
  value: number,
  labels: LabelKV = {}
): void {
  gaugeDescriptions.set(name, help);
  const key = labelKey(name, labels);
  gauges.set(key, value);
}

/**
 * Render the current counter+gauge state in Prometheus exposition
 * format (text/plain; version=0.0.4).
 */
export function renderMetrics(): string {
  const lines: string[] = [];

  const seenCounterNames = new Set<string>();
  for (const [key] of counters) {
    const name = key.split("{")[0]!;
    if (!seenCounterNames.has(name)) {
      lines.push(`# HELP ${name} ${counterDescriptions.get(name) ?? name}`);
      lines.push(`# TYPE ${name} counter`);
      seenCounterNames.add(name);
    }
  }
  for (const [key, value] of counters) {
    lines.push(`${key} ${value}`);
  }

  const seenGaugeNames = new Set<string>();
  for (const [key] of gauges) {
    const name = key.split("{")[0]!;
    if (!seenGaugeNames.has(name)) {
      lines.push(`# HELP ${name} ${gaugeDescriptions.get(name) ?? name}`);
      lines.push(`# TYPE ${name} gauge`);
      seenGaugeNames.add(name);
    }
  }
  for (const [key, value] of gauges) {
    lines.push(`${key} ${value}`);
  }

  // Built-in process metrics.
  const mem = process.memoryUsage();
  lines.push(
    "# HELP process_resident_memory_bytes Resident set size",
    "# TYPE process_resident_memory_bytes gauge",
    `process_resident_memory_bytes ${mem.rss}`,
    "# HELP process_heap_bytes V8 heap used",
    "# TYPE process_heap_bytes gauge",
    `process_heap_bytes ${mem.heapUsed}`,
    "# HELP process_uptime_seconds Process uptime",
    "# TYPE process_uptime_seconds gauge",
    `process_uptime_seconds ${process.uptime()}`
  );

  return lines.join("\n") + "\n";
}
