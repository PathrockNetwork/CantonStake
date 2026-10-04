"use client";

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCantonWallet } from "@/lib/canton";
import { networkMode } from "@/lib/network";
import { shortId } from "@/lib/account-view";
import { createExclusiveAction } from "@/lib/exclusive-action";
import { cancelPendingLoopRequest, fetchPendingLoopRequests, hasPendingLoopCancellation,
  observePendingLoopCancellation, unresolvedLoopCancellations,
  type PendingLoopRequest } from "@/lib/canton/loop-staking-flow";

const SYMBOLS: Record<string, string> = { polygon: "POL", monad: "MON", bnb: "BNB" };

/** Compact recovery inside the existing positions panel, not a separate network dashboard. */
export function LoopPendingRequests() {
  const wallet = useCantonWallet();
  const qc = useQueryClient();
  const run = useRef(createExclusiveAction()).current;
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ party: string; message: string; error: boolean } | null>(null);
  const [confirming, setConfirming] = useState<{ party: string; contractId: string } | null>(null);
  const enabled = networkMode === "testnet" && process.env.NEXT_PUBLIC_LOOP_STAKING_FLOW === "external";
  const requests = useQuery({ queryKey: ["loop-pending-requests", wallet.partyId],
    queryFn: () => fetchPendingLoopRequests(wallet.partyId!), enabled: enabled && !!wallet.partyId,
    refetchInterval: busy ? false : 15000, retry: false, gcTime: 0 });
  if (!enabled) return null;
  const rows = wallet.partyId ? requests.data ?? [] : [];
  const unresolved = wallet.partyId ? unresolvedLoopCancellations(wallet.partyId).filter(ref => !rows.some(row => row.contractId === ref.contractId)) : [];

  const cancel = (request: Pick<PendingLoopRequest, "delegator" | "contractId">, pendingRequest?: PendingLoopRequest) => run(async () => {
    const party = request.delegator;
    setBusy(request.contractId);
    setFeedback(null);
    try {
      const result = pendingRequest ? await cancelPendingLoopRequest(pendingRequest) : await observePendingLoopCancellation(request);
      setFeedback({ party, error: result.status === "pending", message: result.status === "cancelled"
        ? `Cancellation confirmed on Canton (${shortId(result.updateId!, 12)}). No native funds were moved.`
        : result.status === "accepted" ? "The request was accepted, not cancelled. Check your positions."
        : "Cancellation is not confirmed yet. Check again; do not submit another cancellation or native stake." });
      if (result.status !== "pending") {
        setConfirming(null);
        await qc.invalidateQueries({ queryKey: ["loop-pending-requests", party] });
        await qc.invalidateQueries({ queryKey: ["positions"] });
      }
    } catch (error) {
      setFeedback({ party, error: true, message: error instanceof Error ? error.message : "Cancellation could not be confirmed." });
    } finally { setBusy(null); }
  });

  return <section className="account-loop-pending" aria-label="Pending Loop staking requests">
    <div className="account-results"><strong>Pending Loop requests{rows.length ? ` (${rows.length})` : ""}</strong>
      {wallet.partyId && <button className="account-button" disabled={!!busy || requests.isFetching} onClick={() => void requests.refetch()}>Refresh</button>}
    </div>
    {!wallet.partyId ? <p className="account-muted">Connect Loop TestNet to recover pending requests. Native wallet connections alone cannot cancel them.</p>
      : requests.isError ? <p className="account-amount-warning" role="status">{requests.error.message}</p>
      : requests.isLoading ? <p className="account-muted">Checking Canton for your pending requests…</p>
      : !rows.length ? <p className="account-muted">No pending requests for the connected Loop party.</p>
      : <ul className="account-loop-pending__list">{rows.map(request => {
        const checking = hasPendingLoopCancellation(request);
        const confirm = confirming?.party === wallet.partyId && confirming.contractId === request.contractId;
        return <li key={request.contractId}>
          <div><strong>{request.amount} {request.chain ? SYMBOLS[request.chain] ?? "native units" : "native units"}</strong>
            <small>{request.chain ?? "Network not yet bound"} · {request.binding === "unbound" ? "Not adopted — cancel before starting again" : request.binding}</small>
            <small className="mono" title={request.evmAddress}>Wallet {shortId(request.evmAddress, 10)} · Request {shortId(request.contractId, 12)}</small>
          </div>
          <div>{confirm && !checking && <p className="account-amount-warning">Only cancel if you have not sent the native stake. This does not undo or refund a chain transaction.</p>}
            <button className="account-button" disabled={!!busy || (!checking && !request.canCancel)} onClick={() => {
              if (checking || confirm) void cancel(request, request);
              else setConfirming({ party: request.delegator, contractId: request.contractId });
            }}>{busy === request.contractId ? "Checking Loop…" : checking ? "Check cancellation" : confirm ? "Approve cancel in Loop" : "Cancel request"}</button>
            {confirm && !checking && !busy && <button className="account-button" onClick={() => setConfirming(null)}>Keep request</button>}
          </div>
        </li>;
      })}</ul>}
    {!!unresolved.length && <><p className="account-muted">Unconfirmed cancellation attempts — these are not asserted active positions.</p>
      <ul className="account-loop-pending__list">{unresolved.map(ref => <li key={ref.contractId}>
        <span className="mono" title={ref.contractId}>Request {shortId(ref.contractId, 12)}</span>
        <button className="account-button" disabled={!!busy} onClick={() => void cancel(ref)}>Check cancellation</button>
      </li>)}</ul></>}
    {feedback?.party === wallet.partyId && <p role="status" className={feedback.error ? "account-amount-warning" : "account-muted"}>{feedback.message}</p>}
  </section>;
}
