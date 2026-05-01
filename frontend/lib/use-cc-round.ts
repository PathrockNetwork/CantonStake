import { useEffect, useState } from "react";

const ROUND_MS = 600000;
const INITIAL_ROUND = { remainingMs: ROUND_MS, progress: 0, formatted: "10:00" };

function formatRemaining(remainingMs: number) {
  const seconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

function readRound(now = Date.now()) {
  const windowStart = Math.floor(now / ROUND_MS) * ROUND_MS;
  const elapsedMs = now - windowStart;
  const remainingMs = Math.max(0, ROUND_MS - elapsedMs);

  return {
    remainingMs,
    progress: Math.min(1, Math.max(0, elapsedMs / ROUND_MS)),
    formatted: formatRemaining(remainingMs),
  };
}

export function useCcRound() {
  const [round, setRound] = useState(INITIAL_ROUND);

  useEffect(() => {
    setRound(readRound());
    const id = window.setInterval(() => setRound(readRound()), 1000);
    return () => window.clearInterval(id);
  }, []);

  return typeof window === "undefined" ? INITIAL_ROUND : round;
}
