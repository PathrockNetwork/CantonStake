"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { useLoopWallet } from "@/lib/loop-wallet";

const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_FAKE_POSITIONS === "true";

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
  if (DEMO_MODE) return <>{children}</>;
  if (isConnected && loopConnected && partyId) return <>{children}</>;
  return <>{fallback}</>;
}
