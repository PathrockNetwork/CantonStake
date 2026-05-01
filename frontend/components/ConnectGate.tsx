"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { useLoopWallet } from "@/lib/loop-wallet";

export function ConnectGate({
  fallback,
  children,
}: {
  fallback: ReactNode;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const { isConnected } = useAccount();
  const { isConnected: loopConnected, partyId } = useLoopWallet();

  useEffect(() => setMounted(true), []);

  if (!mounted) return <>{fallback}</>;
  if (isConnected && loopConnected && partyId) return <>{children}</>;
  return <>{fallback}</>;
}
