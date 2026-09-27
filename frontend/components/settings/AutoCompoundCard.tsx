"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/primitives/Card";
import { Btn } from "@/components/primitives/Btn";
import { Chip } from "@/components/primitives/Chip";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { disableAutoCompoundPermit, fetchAutoCompoundStatus, listAutoCompoundPermits } from "@/lib/api";
import { CHAINS } from "@/lib/chains";
import { networkMode } from "@/lib/network";
import { tokens } from "@/lib/tokens";

const chainNames = Object.fromEntries(CHAINS.map(chain => [chain.id, chain.name]));

export function AutoCompoundCard({ userId, canRevoke }: { userId?: string; canRevoke: boolean }) {
  const qc = useQueryClient();
  const statusQ = useQuery({
    queryKey: ["auto-compound-status", networkMode], queryFn: fetchAutoCompoundStatus,
    refetchInterval: 30_000, retry: false,
  });
  const permitsQ = useQuery({
    queryKey: ["auto-compound-permits", userId], queryFn: () => listAutoCompoundPermits(userId!),
    enabled: !!userId, refetchInterval: 30_000, retry: false,
  });
  const revoke = useMutation({
    mutationFn: async (id: string) => {
      if (!canRevoke || !userId) throw new Error("Connect the wallets linked to this profile to revoke a permit.");
      return disableAutoCompoundPermit(id);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["auto-compound-permits", userId] }),
  });
  // A stale successful response must not hide a later availability failure.
  const status = statusQ.isError ? undefined : statusQ.data;
  const label = statusQ.isError ? "STATUS UNAVAILABLE" : !status ? "CHECKING"
    : status.status === "disabled" ? "DISABLED" : status.status === "unavailable" ? "UNAVAILABLE" : "AVAILABLE";
  const permits = permitsQ.data?.permits ?? [];

  return <Card padding={22}>
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <SectionLabel>§ Auto-compound</SectionLabel>
      <Chip color={tokens.ink[400]}>{label}</Chip>
    </div>
    <p className="account-muted" role="status">
      {statusQ.isError ? "We could not check auto-compound availability. Saved permits do not confirm that automation is running."
        : !status ? "Checking auto-compound availability…"
        : status.executionEnabled ? "Review your saved permits below. A saved permit does not confirm a completed compound transaction."
        : "Auto-compound is currently unavailable. Your existing stakes remain active; no new auto-compound permits can be created."}
    </p>
    {statusQ.isError && <Btn size="sm" variant="ghost" onClick={() => { void statusQ.refetch(); }}>Retry status</Btn>}
    {!userId ? <p className="account-muted">Connect your registered wallets to view saved permits.</p>
      : permitsQ.isError ? <div role="alert"><p className="account-muted">Saved permits could not be loaded.</p><Btn size="sm" variant="ghost" onClick={() => { void permitsQ.refetch(); }}>Retry permits</Btn></div>
      : permitsQ.isPending ? <p className="account-muted">Loading saved permits…</p>
      : permits.length === 0 ? <p className="account-muted">No saved permits.</p>
      : <div className="account-stack">
        <SectionLabel>Saved permits</SectionLabel>
        {permits.map(permit => {
          const expires = Date.parse(permit.expiresAt);
          const permitStatus = !permit.enabled ? "REVOKED" : !Number.isFinite(expires) ? "INVALID EXPIRY"
            : expires <= Date.now() ? "EXPIRED" : "SAVED";
          return <div key={permit.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, borderTop: `1px solid ${tokens.hairline}`, paddingTop: 12 }}>
            <span>{chainNames[permit.chain] ?? permit.chain}</span>
            <span className="mono" title={permit.validator}>{permit.validator.length > 18 ? `${permit.validator.slice(0, 12)}…${permit.validator.slice(-4)}` : permit.validator}</span>
            <span className="account-muted">{Number.isFinite(expires) ? `Expires ${new Date(expires).toLocaleDateString()}` : "Expiry unavailable"}</span>
            <Chip color={tokens.ink[400]}>{permitStatus}</Chip>
            {permit.enabled && <Btn size="sm" variant="ghost" disabled={!canRevoke || revoke.isPending} onClick={() => revoke.mutate(permit.id)}>Revoke</Btn>}
          </div>;
        })}
        {!canRevoke && <p className="account-muted">Connect the wallets linked to this profile to revoke a saved permit.</p>}
      </div>}
    {revoke.isError && <p role="alert" className="account-save-error">{revoke.error.message}</p>}
  </Card>;
}
