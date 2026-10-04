"use client";

import { useQuery } from "@tanstack/react-query";
import { useCantonWallet } from "@/lib/canton";
import { fetchLoopRewardEntitlements } from "@/lib/canton/loop-staking-flow";
import { networkMode } from "@/lib/network";
import { shortId } from "@/lib/account-view";

/** Compact section inside existing reward details. Reads real coupons only;
 * never offers a fake claim button or counts an entitlement as a payout. */
export function LoopRewardEntitlements() {
  const wallet = useCantonWallet();
  const external = networkMode === "testnet" && process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external";
  const connected = wallet.isConnected && !!wallet.partyId;
  const query = useQuery({ queryKey: ["loop-reward-entitlements", networkMode, wallet.partyId],
    queryFn: () => fetchLoopRewardEntitlements(wallet.partyId!), enabled: external && connected,
    refetchInterval: 60000, retry: false, gcTime: 0 });
  if (!external) return null;
  const snapshot = connected && !query.isError && query.data?.beneficiary === wallet.partyId ? query.data : undefined;
  return <div className="account-loop-pending">
    <div className="account-loop-pending__heading"><h3>Observed CC minting rights</h3>
      {connected && <button className="account-button" disabled={query.isFetching} onClick={() => void query.refetch()}>Refresh</button>}
    </div>
    {!connected ? <p className="account-muted">Connect your real Loop TestNet wallet to read its reward entitlements. Native wallets and the hosted test identity are not substitutes.</p>
      : query.isError ? <p className="account-amount-warning" role="status">{query.error.message} No payment status was inferred.</p>
      : !snapshot ? <p className="account-muted" role="status">Reading your Loop party's Canton reward coupons…</p>
      : <>
        <p className="account-muted"><strong className="mono">{snapshot.observedUnexpiredAmount} CC</strong> in currently observed, unexpired minting rights. This is not minted CC, a wallet balance or a verified payment.</p>
        {!snapshot.coupons.length ? <p className="account-muted">No active coupons are currently visible for this Loop party. This does not establish zero lifetime rewards.</p>
          : <div className="account-table-wrap" style={{ maxHeight: 240, overflow: "auto" }}><table className="account-table"><thead><tr><th>Coupon</th><th>Minting right</th><th>Expires</th></tr></thead><tbody>
            {snapshot.coupons.map(coupon => <tr key={coupon.contractId}><td className="mono" title={coupon.contractId}>{shortId(coupon.contractId, 12)}<small>{coupon.expired ? "Expired · not included in total" : "Entitlement · not payment"}</small></td>
              <td className="mono">{coupon.amount} CC</td><td><time dateTime={coupon.expiresAt}>{new Date(coupon.expiresAt).toLocaleString()}</time></td></tr>)}
          </tbody></table></div>}
        <p className="account-muted">Provider-visible active coupons only · ledger offset <span className="mono">{snapshot.ledgerOffset}</span>. Claimed or archived coupons need separate settlement evidence; they are not counted as paid here.</p>
      </>}
  </div>;
}
