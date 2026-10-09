"use client";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { networkMode } from "./network";
import { readLidoState } from "./lido";

export function useLidoState() {
  const { address } = useAccount();
  const query = useQuery({
    queryKey: ["lido-hoodi", address?.toLowerCase() ?? null],
    queryFn: () => readLidoState(address),
    enabled: networkMode === "testnet",
    refetchInterval: 15000,
    retry: false,
  });
  const state = networkMode === "testnet" && !query.isError && query.data?.wallet?.toLowerCase() === address?.toLowerCase() ? query.data : undefined;
  return { ...query, address, state };
}
