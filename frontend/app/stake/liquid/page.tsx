"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { PolygonLiquidStake } from "@/components/stake/PolygonLiquidStake";

function LiquidStakeContent() {
  const searchParams = useSearchParams();
  return <div className="page-shell account-page">
    <Link className="account-text-link" href="/stake">← All staking networks</Link>
    <PolygonLiquidStake initialDirection={searchParams.get("action") === "exit" ? "exit" : "deposit"} />
  </div>;
}

export default function LiquidStakePage() {
  return <Suspense fallback={<div className="page-shell account-page">Loading liquid staking…</div>}><LiquidStakeContent /></Suspense>;
}
