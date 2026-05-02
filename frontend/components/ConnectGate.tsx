"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useAccount } from "wagmi";

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

  useEffect(() => setMounted(true), []);

  if (!mounted) return <>{fallback}</>;
  if (DEMO_MODE || isConnected) return <>{children}</>;
  return <>{fallback}</>;
}
