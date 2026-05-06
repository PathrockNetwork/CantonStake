"use client";

/**
 * Tiny localStorage-backed lookup for "which chain did this stake go to?"
 *
 * The Daml StakingPosition template doesn't carry a `chain` field yet (a
 * DAR redeploy would be needed to add one). To keep the UI honest about
 * which chain each row belongs to, the stake page records the chain at
 * submit-time keyed by `(evmAddress, amountPol)`, and the
 * positions/dashboard rows read it back to render the right symbol.
 *
 * Limits:
 *   - Only positions staked on THIS device through THIS UI populate the map.
 *   - Positions older than the localStorage entry, or staked from a
 *     different device, fall back to the address-format heuristic in
 *     `chainFromAddress`.
 *
 * Replace this with a backend metadata table once the Daml template
 * lands a real `chain` field.
 */

import type { ChainConfig } from "@/lib/chains";

const STORAGE_KEY = "cantonstake_position_chain_map";

type ChainId = ChainConfig["id"];
type Map = Record<string, ChainId>;

function key(evmAddress: string, amountPol: string): string {
  return `${evmAddress.toLowerCase()}:${amountPol}`;
}

function readMap(): Map {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Map) : {};
  } catch {
    return {};
  }
}

function writeMap(map: Map): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // quota / private mode — silently drop
  }
}

export function recordPositionChain(
  evmAddress: string,
  amountPol: string,
  chainId: ChainId,
): void {
  const map = readMap();
  map[key(evmAddress, amountPol)] = chainId;
  writeMap(map);
}

export function lookupPositionChain(
  evmAddress: string,
  amountPol: string,
): ChainId | undefined {
  const map = readMap();
  return map[key(evmAddress, amountPol)];
}
