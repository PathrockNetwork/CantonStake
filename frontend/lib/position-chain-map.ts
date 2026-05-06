"use client";

/**
 * Tiny localStorage-backed lookup for position metadata.
 *
 * Stores: chain + validator address for each position so we can
 * properly build unbond/claim transactions later.
 *
 * The Daml StakingPosition template doesn't carry these fields yet
 * (a DAR redeploy would be needed to add them). To keep the UI
 * functional, the stake page records metadata at submit-time keyed by
 * (evmAddress, amountPol), and the positions page reads it back.
 *
 * Limits:
 *   - Only positions staked on THIS device through THIS UI populate the map.
 *   - Positions older than the localStorage entry, or staked from a
 *     different device, fall back to the address-format heuristic.
 *
 * Replace this with a backend metadata table once the Daml template
 * lands real metadata fields.
 */

import type { ChainConfig } from "@/lib/chains";

const STORAGE_KEY = "cantonstake_position_meta_map";

type ChainId = ChainConfig["id"];

interface PositionMeta {
  chainId: ChainId;
  validator: string;
}

type Map = Record<string, PositionMeta>;

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

export function recordPositionMeta(
  evmAddress: string,
  amountPol: string,
  chainId: ChainId,
  validator: string,
): void {
  const map = readMap();
  map[key(evmAddress, amountPol)] = { chainId, validator };
  writeMap(map);
}

// Legacy function name for compatibility
export function recordPositionChain(
  evmAddress: string,
  amountPol: string,
  chainId: ChainId,
): void {
  const map = readMap();
  const existing = map[key(evmAddress, amountPol)];
  map[key(evmAddress, amountPol)] = {
    chainId,
    validator: existing?.validator ?? "",
  };
  writeMap(map);
}

export function lookupPositionMeta(
  evmAddress: string,
  amountPol: string,
): PositionMeta | undefined {
  const map = readMap();
  return map[key(evmAddress, amountPol)];
}

export function lookupPositionChain(
  evmAddress: string,
  amountPol: string,
): ChainId | undefined {
  return lookupPositionMeta(evmAddress, amountPol)?.chainId;
}

export function lookupPositionValidator(
  evmAddress: string,
  amountPol: string,
): string | undefined {
  return lookupPositionMeta(evmAddress, amountPol)?.validator;
}
