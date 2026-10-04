"use client";

import type { RewardHistoryEvent } from "@/lib/api";
import { CHAINS } from "@/lib/chains";
import { fmt } from "@/lib/format";
import { nativeRewardGroups, recordedRewardTotal } from "@/lib/native-reward-groups";
import { AccountEmpty, AccountIcon, AccountLink, AccountPanel, ChainBadge } from "./AccountUI";

export function RewardsOverview({ history, connected, available, loading, failed, partial, days }: {
  history: RewardHistoryEvent[]; connected: boolean; available: boolean; loading: boolean;
  failed: boolean; partial: boolean; days: number;
}) {
  const visible = connected && available && !failed;
  const cc = visible ? history.filter(event => event.kind === "cc") : [];
  const ccTotal = visible ? recordedRewardTotal(cc) : undefined;
  const payouts = visible ? nativeRewardGroups(history) : [];
  return <AccountPanel id="rewards-overview" title="Rewards overview" icon="coin"
    description={`${partial ? "Displayed" : "Recorded"} allocations and payouts · last ${days} days`}
    action={<AccountLink href="#reward-history">View history</AccountLink>}>
    {!connected ? <AccountEmpty>Connect your wallet to see recorded rewards across your networks.</AccountEmpty> : <>
      <table className="account-reward-overview-table">
        <caption className="sr-only">Recorded rewards grouped by network and token</caption>
        <thead><tr><th scope="col">Network · reward</th><th scope="col">Amount</th><th scope="col">Events</th></tr></thead>
        <tbody>
          <tr data-reward-kind="cc"><td><span className="account-chain"><span className="account-reward-canton-mark" aria-hidden="true"><AccountIcon name="coin" size={28} /></span>Canton</span><small>CC allocations · beneficiary share</small></td>
            <td className="mono account-reward-cc-amount">{ccTotal === undefined ? "—" : `${fmt(ccTotal, 2)} CC`}</td><td className="mono">{visible ? cc.length : "—"}</td></tr>
          {payouts.map(group => {
            const chain = CHAINS.find(c => c.id === group.chain.replace(/-(mainnet|testnet|amoy)$/, ""));
            return <tr key={group.key} data-reward-kind="native"><td><ChainBadge chainId={chain?.id} symbol={group.symbol} label={chain?.id === "polygon" ? "Polygon" : chain?.name ?? group.chain} /><small>Native payout · {group.symbol}</small></td>
              <td className="mono">{group.total === undefined ? "—" : `${fmt(group.total, 2)} ${group.symbol}`}</td><td className="mono">{group.events.length}</td></tr>;
          })}
        </tbody>
      </table>
      {failed ? <p role="status" className="account-amount-warning">Reward totals are temporarily unavailable.</p>
        : loading || !available ? <p role="status" className="account-muted">Loading recorded rewards…</p>
        : <p className="account-muted account-reward-overview-note">{partial ? "Amounts cover the latest displayed events, not the full period. " : ""}Only recorded allocations and payouts are included. Staked balances and unmeasured yield are excluded.</p>}
    </>}
  </AccountPanel>;
}
