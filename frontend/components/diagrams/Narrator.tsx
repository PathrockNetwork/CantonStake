"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/primitives/Card";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { fetchNarrator } from "@/lib/api";
import { tokens } from "@/lib/tokens";

/**
 * Narrator — plain-English commentary for the /rewards visualizer.
 *
 * Polls the backend `/api/narrator/:address` endpoint. The default path
 * is a rule-based generator (trend-aware, deterministic, no API cost).
 * When `ANTHROPIC_API_KEY` is set on the backend, Claude Haiku is used
 * instead and the pill flips to "live · claude".
 */
export function Narrator({ address }: { address: string | undefined }) {
  const { data, isLoading } = useQuery({
    queryKey: ["narrator", address],
    queryFn: () => (address ? fetchNarrator(address) : null),
    enabled: !!address,
    refetchInterval: 30_000,
    staleTime: 25_000,
  });

  if (!address) return null;

  const text = data?.text;
  const source = data?.context.source ?? "rule-based";
  const model = data?.model;
  const isLLM = source === "anthropic";

  return (
    <Card style={{ marginTop: 18, padding: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 8,
        }}
      >
        <SectionLabel>§ A1 · narrator</SectionLabel>
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            letterSpacing: 0.6,
            textTransform: "uppercase",
            color: isLLM ? tokens.cc : tokens.ink[400],
            border: `1px solid ${isLLM ? tokens.cc : tokens.hairline}`,
            padding: "1px 6px",
            borderRadius: 999,
          }}
        >
          {isLLM ? "live · claude" : "rule-based"}
        </span>
      </div>

      <div
        style={{
          fontSize: 15.5,
          lineHeight: 1.55,
          color: tokens.ink[100],
          minHeight: 44,
          fontFamily: "var(--font-display, inherit)",
        }}
      >
        {isLoading && !text ? (
          <span className="mono" style={{ color: tokens.ink[400], fontSize: 12 }}>
            generating round narration...
          </span>
        ) : (
          text ?? "—"
        )}
      </div>

      {isLLM && model && (
        <div
          className="mono"
          style={{
            marginTop: 10,
            fontSize: 10.5,
            color: tokens.ink[400],
            letterSpacing: 0.4,
          }}
        >
          model: {model}
        </div>
      )}
    </Card>
  );
}
