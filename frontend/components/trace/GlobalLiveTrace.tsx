"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { tokens } from "@/lib/tokens";
import {
  startAmbientTrace,
  useTraceLog,
  type TraceEntry,
  type TraceTag,
} from "@/components/trace/useTraceLog";

type TraceFilter = "all" | "polygon" | "canton" | "marker" | "coupon";

const FILTERS: Array<{ id: TraceFilter; label: string }> = [
  { id: "all", label: "ALL" },
  { id: "polygon", label: "POLYGON" },
  { id: "canton", label: "CANTON" },
  { id: "marker", label: "MARKER" },
  { id: "coupon", label: "COUPON" },
];

const TAG_COLOR: Record<TraceTag, string> = {
  info: tokens.ink[200],
  idle: tokens.ink[300],
  success: tokens.neon,
  cc: tokens.cc,
  warn: tokens.warning,
  error: tokens.danger,
};

function kindColor(kind: TraceEntry["kind"]): string {
  switch (kind) {
    case "CANTON": return tokens.neon;
    case "POLYGON":
    case "EVM": return tokens.amberBright;
    case "COSMOS": return tokens.ink[200];
    case "SUI": return "#4ca2ff";
    case "MARKER": return tokens.cc;
    case "WALLET": return tokens.ink[200];
    case "ORCH": return tokens.ink[300];
    default: return tokens.ink[300];
  }
}

function matchesFilter(entry: TraceEntry, filter: TraceFilter): boolean {
  if (filter === "all") return true;
  if (filter === "coupon") return entry.tag === "cc" || /coupon/i.test(entry.code);
  if (filter === "polygon") return entry.kind === "POLYGON" || entry.kind === "EVM";
  if (filter === "canton") return entry.kind === "CANTON" && entry.tag !== "cc" && !/coupon/i.test(entry.code);
  return entry.kind === "MARKER";
}

function formatTime(time: number): string {
  return new Date(time).toLocaleTimeString("en-GB", { hour12: false });
}

export function GlobalLiveTrace() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [activeFilter, setActiveFilter] = useState<TraceFilter>("all");
  const log = useTraceLog();
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    startAmbientTrace();
  }, []);

  const counts = useMemo(() => Object.fromEntries(
    FILTERS.map(({ id }) => [id, id === "all" ? log.length : log.filter(entry => matchesFilter(entry, id)).length]),
  ) as Record<TraceFilter, number>, [log]);
  const visibleEntries = useMemo(
    () => log.filter(entry => matchesFilter(entry, activeFilter)),
    [log, activeFilter],
  );

  useEffect(() => {
    if (open && scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [open, activeFilter, visibleEntries.length]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (pathname === "/") return null;

  return (
    <>
      {!open && (
        <button
          type="button"
          className="trace-launcher mono"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          aria-controls="global-live-trace"
        >
          <span className="trace-live-dot" aria-hidden="true" />
          LIVE TRACE
        </button>
      )}

      <aside
        id="global-live-trace"
        className={`trace-drawer${open ? " trace-drawer--open" : ""}`}
        aria-hidden={!open}
        inert={!open}
        aria-label="Global live trace"
      >
        <header className="trace-header">
          <div className="trace-header__identity">
            <span className="trace-live-dot" aria-hidden="true" />
            <span className="trace-header__title mono">LIVE TRACE</span>
            <span className="trace-header__uri mono">cantonstake://trace/global</span>
          </div>
          <span className="trace-streaming mono"><i aria-hidden="true" /> STREAMING</span>
        </header>

        <div className="trace-filters mono" role="group" aria-label="Filter trace events">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              id={`trace-filter-${id}`}
              type="button"
              aria-pressed={activeFilter === id}
              className="trace-filter"
              onClick={() => setActiveFilter(id)}
            >
              <span>{label}</span>
              <span className="trace-filter__count">({counts[id]})</span>
            </button>
          ))}
        </div>

        <div
          ref={scroller}
          id="trace-events"
          className="trace-events"
          role="region"
          aria-label="Trace events"
          tabIndex={0}
        >
          {visibleEntries.length === 0 ? (
            <p className="trace-empty mono">{log.length === 0 ? "Awaiting events…" : "No events in this category yet."}</p>
          ) : visibleEntries.map(entry => {
            const color = kindColor(entry.kind);
            return (
              <article key={entry.id} className="trace-event">
                <time className="trace-event__time mono" dateTime={new Date(entry.t).toISOString()}>{formatTime(entry.t)}</time>
                <span
                  className={`trace-event__dot${entry.kind === "MARKER" ? " trace-event__dot--marker" : ""}`}
                  style={{ backgroundColor: color }}
                  aria-hidden="true"
                />
                <div className="trace-event__copy">
                  <div className="trace-event__heading">
                    <span className="trace-event__kind mono" style={{ color }}>{entry.kind}</span>
                    <span className="trace-event__code" style={{ color: TAG_COLOR[entry.tag] }}>{entry.code}</span>
                  </div>
                  <p className="trace-event__detail">{entry.detail}</p>
                </div>
              </article>
            );
          })}
        </div>

        <footer className="trace-footer">
          <span className="trace-footer__count mono">
            {activeFilter === "all" ? counts.all : `${counts[activeFilter]} / ${counts.all}`} events
          </span>
          <span className="trace-footer__note mono">self-custody · keys never leave wallet</span>
          <button type="button" className="trace-hide mono" onClick={() => setOpen(false)} aria-expanded={true} aria-controls="global-live-trace">
            <svg viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 2l10 10M5.6 5.6a2 2 0 002.8 2.8M1.5 7s1.8-4 5.5-4c1.2 0 2.2.4 3 1M12.5 7s-1.8 4-5.5 4c-.7 0-1.3-.1-1.9-.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>
            HIDE TRACE
          </button>
        </footer>
      </aside>
    </>
  );
}
