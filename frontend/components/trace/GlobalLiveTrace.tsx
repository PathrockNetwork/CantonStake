"use client";

import { useEffect, useRef, useState } from "react";
import { tokens } from "@/lib/tokens";
import {
  startAmbientTrace,
  useTraceLog,
  type TraceEntry,
  type TraceTag,
} from "@/components/trace/useTraceLog";

/**
 * Always-on bottom-right "Live Trace" toggle that opens a 420px
 * right-side drawer streaming ambient + emitted trace events.
 * Ported from handoff/prototype/redesign/livetrace.jsx.
 *
 * Mount once near the root (in app/layout.tsx, post-Step 6 swap).
 * State (open/closed) is owned by this component — there is no
 * external API. Keep it that way; the drawer is a developer-affordance
 * surface, not part of any user flow.
 */

const TAG_COLOR: Record<TraceTag, string> = {
  info: tokens.ink[200],
  idle: tokens.ink[400],
  success: tokens.neon,
  cc: tokens.cc,
  warn: tokens.warning,
  error: tokens.danger,
};

function kindColor(kind: TraceEntry["kind"]): string {
  switch (kind) {
    case "CANTON":
      return tokens.neon;
    case "POLYGON":
      return tokens.amberBright;
    case "MARKER":
      return tokens.cc;
    case "WALLET":
      return tokens.ink[200];
    case "ORCH":
      return tokens.ink[300];
    default:
      return tokens.ink[300];
  }
}

function formatTime(t: number): string {
  return new Date(t).toLocaleTimeString("en-GB", { hour12: false });
}

export function GlobalLiveTrace() {
  const [open, setOpen] = useState(false);
  const log = useTraceLog();
  const scroller = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    startAmbientTrace();
  }, []);

  useEffect(() => {
    if (scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [log.length]);

  return (
    <>
      {/* Toggle button — always visible */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="mono"
        type="button"
        style={{
          position: "fixed",
          right: open ? 420 : 18,
          bottom: 18,
          zIndex: 60,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 14px",
          background: tokens.ink[900],
          border: `1px solid ${tokens.hairline}`,
          color: tokens.ink[100],
          fontSize: 10.5,
          letterSpacing: ".12em",
          textTransform: "uppercase",
          cursor: "pointer",
          transition: "right 240ms ease",
          borderRadius: 0,
        }}
      >
        <span
          style={{
            display: "inline-block",
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: tokens.neon,
            animation: "pulse-dot 2s infinite",
          }}
        />
        {open ? "Hide Trace" : "Live Trace"}
      </button>

      {/* Drawer */}
      <aside
        aria-hidden={!open}
        style={{
          position: "fixed",
          top: 0,
          right: open ? 0 : -420,
          bottom: 0,
          width: 420,
          background: "#08080a",
          borderLeft: `1px solid ${tokens.hairline}`,
          zIndex: 55,
          transition: "right 240ms ease",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "14px 18px",
            borderBottom: `1px solid ${tokens.hairline}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ display: "flex", gap: 5 }}>
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: tokens.danger,
                  opacity: 0.6,
                }}
              />
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: tokens.warning,
                  opacity: 0.6,
                }}
              />
              <span
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: "50%",
                  background: tokens.success,
                  opacity: 0.6,
                }}
              />
            </div>
            <span
              className="mono"
              style={{
                fontSize: 10.5,
                color: tokens.ink[400],
                letterSpacing: ".08em",
              }}
            >
              cantonstake://trace/global
            </span>
          </div>
          <span
            className="mono"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "2px 8px",
              fontSize: 9,
              letterSpacing: ".1em",
              color: tokens.neon,
              border: `1px solid ${tokens.neon}`,
            }}
          >
            <span
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: tokens.neon,
                animation: "pulse-dot 2s infinite",
              }}
            />
            STREAMING
          </span>
        </div>

        {/* Body */}
        <div
          ref={scroller}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "14px 18px",
            fontFamily: "JetBrains Mono, ui-monospace, monospace",
            fontSize: 11,
            lineHeight: 1.65,
            color: tokens.ink[300],
          }}
        >
          <div style={{ color: tokens.ink[500], marginBottom: 8 }}>
            $ tail -f /var/canton/cantonstake/markers.log
          </div>
          {log.length === 0 && (
            <div style={{ color: tokens.ink[500] }}>
              ▸ awaiting events
              <span
                style={{
                  display: "inline-block",
                  width: 6,
                  height: 11,
                  background: tokens.neon,
                  marginLeft: 4,
                  verticalAlign: "middle",
                  animation: "blink-caret 1s steps(1) infinite",
                }}
              />
            </div>
          )}
          {log.map((e) => (
            <div
              key={e.id}
              style={{ marginBottom: 8, animation: "fade-up 220ms ease" }}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                <span style={{ color: tokens.ink[500], fontSize: 9.5 }}>
                  {formatTime(e.t)}
                </span>
                <span
                  style={{
                    color: kindColor(e.kind),
                    fontSize: 9.5,
                    letterSpacing: ".1em",
                  }}
                >
                  {e.kind}
                </span>
                <span style={{ color: TAG_COLOR[e.tag] ?? tokens.ink[200] }}>
                  ▸ {e.code}
                </span>
              </div>
              <div
                style={{
                  color: tokens.ink[400],
                  marginLeft: 18,
                  fontSize: 10,
                }}
              >
                {e.detail}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: "10px 18px",
            borderTop: `1px solid ${tokens.hairline}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <span
            className="mono"
            style={{ fontSize: 10, color: tokens.ink[400] }}
          >
            {log.length} event{log.length === 1 ? "" : "s"}
          </span>
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: tokens.ink[500],
              letterSpacing: ".06em",
            }}
          >
            self-custody · keys never leave wallet
          </span>
        </div>
      </aside>
    </>
  );
}
