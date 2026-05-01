"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { useLoopWallet } from "@/lib/loop-wallet";

export function ConnectWall({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { isConnected } = useAccount();
  const { isConnected: loopConnected, partyId } = useLoopWallet();
  const wallOn = process.env.NEXT_PUBLIC_REQUIRE_CONNECT_WALL === "true";
  const onConnect = pathname === "/connect";
  const allowed = isConnected && loopConnected && !!partyId;

  useEffect(() => {
    if (wallOn && !allowed && !onConnect) router.push("/connect");
  }, [allowed, onConnect, router, wallOn]);

  return <>{children}</>;
}
