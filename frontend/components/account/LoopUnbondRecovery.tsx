"use client";

import { useEffect, useState } from "react";
import { loopUnbondRecoveryState, recoverLoopUnbondUpdate, recoverNativeLoopUnbond,
  type LoopUnbondPosition } from "@/lib/canton/loop-staking-flow";
import { createExclusiveAction } from "@/lib/exclusive-action";

/** Read-only receipt reconciliation: no native send and no new Loop command. */
export function LoopUnbondRecovery({ position, disabled, run, onBusy, onResult }: {
  position: LoopUnbondPosition;
  disabled: boolean;
  run: ReturnType<typeof createExclusiveAction>;
  onBusy: (busy: boolean) => void;
  onResult: (message: string, error: boolean) => void;
}) {
  const [state, setState] = useState<ReturnType<typeof loopUnbondRecoveryState>>({ loop: null, native: null, nativeBlock: null, storageUnavailable: false });
  const [updateId, setUpdateId] = useState("");
  const [nativeHash, setNativeHash] = useState("");
  const [nativeBlockHash, setNativeBlockHash] = useState("");
  useEffect(() => {
    const sync = () => {
      const next = loopUnbondRecoveryState(position);
      setState(next);
      if (position.chain === "polkadot" && /^0x[a-fA-F0-9]{64}$/.test(next.nativeBlock ?? "")) setNativeBlockHash(value => value || next.nativeBlock!);
      if (next.loop && next.loop !== "submission-uncertain") setUpdateId(value => value || next.loop!);
      if (next.native && (position.chain === "solana" ? /^[1-9A-HJ-NP-Za-km-z]{64,88}$/ : position.chain === "sui" ? /^[1-9A-HJ-NP-Za-km-z]{32,44}$/ : /^(?:0x)?[a-fA-F0-9]{64}$/).test(next.native)) setNativeHash(value => value || next.native!);
    };
    sync();
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [position.contractId, position.delegator, position.chain, disabled]);

  if (state.storageUnavailable) return <p role="status" className="account-amount-warning">Browser storage is unavailable. Receipt recovery and safe retry tracking require storage; no new unstake will be sent.</p>;
  if (!state.loop && !state.native) return null;

  const reconcile = (kind: "loop" | "native") => run(async () => {
    onBusy(true);
    try {
      if (kind === "loop") {
        await recoverLoopUnbondUpdate(position, updateId.trim());
        onResult("Existing Loop unbond approval was independently confirmed. No native transaction was sent by this check.", false);
      } else {
        const result = await recoverNativeLoopUnbond(position, nativeHash.trim(), nativeBlockHash.trim() || undefined);
        onResult(result.status === "pending" ? "No mined receipt is visible yet. Keep the guard and check again; do not send another unstake."
          : result.status === "settled" ? "A matching native unstake settled. Wait for Canton indexing; do not unstake again."
          : result.retryAllowed ? "The recorded native unstake reverted. Its retry guard was cleared; a new unstake requires fresh preflight."
          : "This hash reverted, but the original broadcast hash is unknown. The guard remains; operator reconciliation is required before retrying.",
          result.status === "pending" || (result.status === "reverted" && !result.retryAllowed));
      }
      setState(loopUnbondRecoveryState(position));
    } catch (error) {
      onResult(error instanceof Error ? error.message : "Receipt reconciliation is unavailable. Retry guards were retained.", true);
    } finally { onBusy(false); }
  });

  return <details className="account-loop-unbond-recovery">
    <summary>Recover existing unbond receipts</summary>
    <p className="account-muted">These checks are read-only. Enter a receipt from Loop or your native wallet; no new approval or transaction will be submitted.</p>
    {state.loop && <div className="account-loop-unbond-recovery__row"><label>Loop ledger update ID
      <input className="account-field mono" aria-label="Loop unbond update ID" value={updateId} onChange={event => setUpdateId(event.target.value)} maxLength={255} placeholder="Update ID from Loop transaction details" disabled={disabled} />
    </label><button className="account-button" disabled={disabled || !updateId.trim()} onClick={() => void reconcile("loop")}>Check Loop receipt</button></div>}
    {state.native && <div className="account-loop-unbond-recovery__row"><label>Native unstake transaction hash
      <input className="account-field mono" aria-label="Native unbond transaction hash" value={nativeHash} onChange={event => setNativeHash(event.target.value)} maxLength={position.chain === "solana" ? 88 : 66} placeholder={position.chain === "solana" ? "Case-sensitive Solana transaction signature" : position.chain === "sui" ? "Case-sensitive Sui transaction digest" : ["cosmos", "celestia", "osmosis"].includes(position.chain) ? "64-character Cosmos transaction hash" : "0x… from the native wallet"} disabled={disabled} />
    </label>{position.chain === "polkadot" && <label>Finalized Westend block hash
      <input className="account-field mono" aria-label="Native unbond finalized block hash" value={nativeBlockHash} onChange={event => setNativeBlockHash(event.target.value)} maxLength={66} placeholder="0x… block hash from the wallet or explorer" disabled={disabled} />
    </label>}<button className="account-button" disabled={disabled || !nativeHash.trim() || (position.chain === "polkadot" && !nativeBlockHash.trim())} onClick={() => void reconcile("native")}>Check native receipt</button></div>}
  </details>;
}
