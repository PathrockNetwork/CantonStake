"use client";

import { useEffect, useState } from "react";

/**
 * In-browser pubsub for observed wallet and application events.
 * The log starts empty; there are no generated background events.
 */

export type TraceKind =
  | "CANTON"
  | "POLYGON"
  | "EVM"
  | "COSMOS"
  | "SUI"
  | "MOVE"
  | "SUBSTRATE"
  | "SVM"
  | "MARKER"
  | "WALLET"
  | "ORCH";
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
