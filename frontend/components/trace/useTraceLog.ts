"use client";

import { useEffect, useState } from "react";

/**
 * Tiny global pubsub for live trace events. Ported from
 * handoff/prototype/redesign/livetrace.jsx.
 *
 * The prototype used a `window.emitTrace` global. Since the existing
 * repo already has Zustand (per PORT_GUIDE §3 Step 4 note), we could
 * upgrade this later. For now we keep the global pubsub — it's tiny,
 * dependency-free, and matches the prototype's behavior for review.
 */

export type TraceKind = "CANTON" | "POLYGON" | "MARKER" | "WALLET" | "ORCH";
export type TraceTag = "info" | "idle" | "success" | "cc" | "warn" | "error";

export type TraceEntry = {
  id: string;
  t: number;
  kind: TraceKind;
  code: string;
  detail: string;
  tag: TraceTag;
};

type Listener = (entry: TraceEntry) => void;
const listeners = new Set<Listener>();

export function emitTrace(entry: Omit<TraceEntry, "id" | "t"> & { t?: number }) {
  const full: TraceEntry = {
    id: Math.random().toString(36).slice(2, 8),
    t: entry.t ?? Date.now(),
    kind: entry.kind,
    code: entry.code,
    detail: entry.detail,
    tag: entry.tag,
  };
  listeners.forEach((fn) => fn(full));
}

export function useTraceLog(maxEntries = 200): TraceEntry[] {
  const [log, setLog] = useState<TraceEntry[]>([]);
  useEffect(() => {
    const fn: Listener = (e) =>
      setLog((prev) => [...prev.slice(-(maxEntries - 1)), e]);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, [maxEntries]);
  return log;
}

/**
 * Auto-emit ambient marker events every ~7s so the drawer always has
 * a heartbeat. Idempotent — safe to call from multiple components.
 */
let ambientStarted = false;
let ambientTimer: ReturnType<typeof setInterval> | null = null;

const SAMPLES: Array<Omit<TraceEntry, "id" | "t">> = [
  {
    kind: "CANTON",
    code: "Position update",
    detail: "lifecycle=Bonded → marker scheduled",
    tag: "info",
  },
  {
    kind: "POLYGON",
    code: "Block tick",
    detail: "block=42,108,847  rpc=42ms",
    tag: "idle",
  },
  {
    kind: "MARKER",
    code: "Bond marker emitted",
    detail: "weight=0.18 USD  split=75/25",
    tag: "success",
  },
  {
    kind: "CANTON",
    code: "Coupon minted",
    detail: "round=2873541  cc=412.8",
    tag: "cc",
  },
  {
    kind: "POLYGON",
    code: "Validator share read",
    detail: "delegator=0x7c3a...e91d  ok",
    tag: "idle",
  },
];

export function startAmbientTrace(): void {
  if (ambientStarted) return;
  if (typeof window === "undefined") return;
  ambientStarted = true;
  let i = 0;
  ambientTimer = setInterval(() => {
    emitTrace(SAMPLES[i % SAMPLES.length]);
    i += 1;
  }, 7_000);
}

export function stopAmbientTrace(): void {
  if (ambientTimer != null) {
    clearInterval(ambientTimer);
    ambientTimer = null;
  }
  ambientStarted = false;
}
