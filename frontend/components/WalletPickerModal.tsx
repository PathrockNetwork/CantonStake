"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { hoodi } from "wagmi/chains";
import { networkMode } from "@/lib/network";
import { useCantonWallet } from "@/lib/canton";
import { isChainEnabled, polygonSettlementChain, monadEvmChain, bnbEvmChain, type ChainConfig } from "@/lib/chains";
import { useCosmosWallet } from "@/lib/cosmos/use-cosmos-wallet";
import { type CosmosChainKey } from "@/lib/cosmos/networks";
import { useSuiWallet } from "@/lib/sui/use-sui-wallet";
import { useAptosWallet } from "@/lib/aptos/use-aptos-wallet";
import { useSolanaWallet } from "@/lib/solana/use-solana-wallet";
import { usePolkadotWallet } from "@/lib/polkadot/use-polkadot-wallet";

import styles from "./WalletPickerModal.module.css";

interface Props {
  open: boolean;
  onClose: () => void;
}

function connectorBlurb(id: string): string {
  switch (id) {
    case "injected":
      return "MetaMask, Rabby, Brave, or another installed browser wallet";
    case "io.metamask":
    case "metaMaskSDK":
      return "Connect with your MetaMask browser extension";
    case "io.rabby":
      return "Connect with your Rabby browser extension";
    case "coinbaseWalletSDK":
    case "coinbaseWallet":
      return "Coinbase Wallet · extension or mobile via deep link";
    case "walletConnect":
      return "WalletConnect v2 · Ledger Live, Trust, Rainbow, mobile wallets";
    case "safe":
      return "Safe · only available when this dApp is loaded inside the Safe app";
    default:
      return "";
  }
}

const walletLogos: Array<[RegExp, string]> = [
  [/metamask/i, "metamask.svg"], [/coinbase/i, "coinbase.svg"], [/walletconnect/i, "walletconnect.svg"],
  [/^safe$/i, "safe.svg"], [/rabby/i, "rabby.svg"], [/trust/i, "trust.svg"], [/ledger/i, "ledger.svg"],
  [/okx/i, "okx.svg"], [/phantom/i, "phantom.svg"], [/keplr/i, "keplr.svg"], [/leap/i, "leap.svg"],
  [/talisman/i, "talisman.svg"], [/subwallet/i, "subwallet.svg"], [/polkadot[ .-]?js/i, "polkadotjs.svg"],
  [/slush/i, "slush.svg"], [/petra/i, "petra.png"],
  [/brave/i, "brave.svg"], [/rainbow/i, "rainbow.svg"],
];

function WalletIcon({ name, walletId, icon }: { name: string; walletId?: string; icon?: string }) {
  const logo = walletLogos.find(([pattern]) => pattern.test(walletId ?? name) || pattern.test(name))?.[1];
  const source = logo ? `/wallets/${logo}` : icon;
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <span className={styles.providerIcon} aria-hidden="true">
    {source && failedSource !== source ? <img src={source} alt="" onError={() => setFailedSource(source)} />
      : <svg viewBox="0 0 32 32" fill="none" focusable="false">
        <rect x="4" y="7" width="24" height="19" rx="4" stroke="currentColor" strokeWidth="2" />
        <path d="M5 10V7a3 3 0 0 1 3-3h15v3M28 14h-7a3 3 0 0 0 0 6h7" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
        <circle cx="22" cy="17" r="1" fill="currentColor" />
      </svg>}
  </span>;
}

function WalletOption({ name, walletId, description, detected = false, availability = "Not detected", icon, pending, onClick }: {
  name: string; walletId?: string; description?: string; detected?: boolean; availability?: string; icon?: string; pending?: boolean; onClick: () => void;
}) {
  return <button type="button" className={styles.walletOption} data-detected={detected} disabled={pending} onClick={onClick}>
    <WalletIcon name={name} walletId={walletId} icon={icon} />
    <span className={styles.providerDetails}>
      <span className={styles.providerName}>{name}<small className={styles.providerBadge}>{detected ? "Detected" : availability}</small></span>
      {description && <small className={styles.providerDescription}>{description}</small>}
    </span>
    <span className={styles.providerConnect}>{pending ? "Opening…" : "Connect"}</span>
  </button>;
}

function EcosystemIcon({ kind }: { kind: "evm" | "cosmos" | "other" }) {
  return <svg viewBox="0 0 48 48" fill="none" aria-hidden="true">
    {kind === "evm" ? <>
      <path d="M24 3 11 25l13 8 13-8L24 3Z" fill="currentColor" opacity=".85" />
      <path d="m24 3 0 30 13-8L24 3Z" fill="#5ddcce" />
      <path d="m11 28 13 17 13-17-13 8-13-8Z" fill="currentColor" />
      <path d="m11 25 13-6 13 6-13 8-13-8Z" fill="#063f40" opacity=".7" />
    </> : kind === "cosmos" ? <g stroke="currentColor" strokeWidth="1.4">
      <ellipse cx="24" cy="24" rx="8" ry="21" />
      <ellipse cx="24" cy="24" rx="8" ry="21" transform="rotate(60 24 24)" />
      <ellipse cx="24" cy="24" rx="8" ry="21" transform="rotate(120 24 24)" />
      <circle cx="24" cy="24" r="3" fill="currentColor" />
    </g> : <g stroke="currentColor" strokeWidth="1.6">
      <circle cx="18" cy="26" r="12" /><circle cx="32" cy="10" r="7" /><circle cx="33" cy="38" r="7" />
    </g>}
  </svg>;
}

function Ecosystem({ kind, title, count, children }: {
  kind: "evm" | "cosmos" | "other"; title: string; count: number; children: ReactNode;
}) {
  if (!count) return null;
  return <section className={styles.ecosystem} aria-label={title}>
    <div className={styles.ecosystemHeading}>
      <span className={styles.ecosystemIcon}><EcosystemIcon kind={kind} /></span>
      <h4>{title}</h4><span className={styles.networkCount}>{count} {count === 1 ? "network" : "networks"}</span>
    </div>
    {children}
  </section>;
}

function WalletCard({ id, label, connected, address, busy, onClick, error, expanded }: {
  id: string; label: string; connected: boolean; address?: string | null;
  busy?: boolean; onClick: () => void; error?: string | null; expanded?: boolean;
}) {
  return <div className={styles.walletCard} data-connected={connected} data-selected={expanded}>
    <div className={styles.walletIdentity}>
      <span className={styles.networkIcon}><img src={`/networks/${id}.svg`} width="36" height="36" alt="" /></span>
      <div className={styles.walletDetails}>
        <span className={styles.walletName}>{label}</span>
        <span className={styles.walletStatus} title={connected ? address ?? "Connected" : undefined}>
          <i />{connected ? address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Connected" : "Not connected"}
        </span>
      </div>
    </div>
    <button type="button" className={styles.action} data-ghost={connected} disabled={busy}
      aria-label={`${connected ? "Disconnect" : "Connect"} ${label}`} aria-expanded={expanded}
      onClick={onClick}>{busy ? "Opening…" : connected ? "Disconnect" : "Connect"}</button>
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </div>;
}

export function WalletPickerModal({ open, onClose }: Props) {
  const { connectors, connectAsync, status: connectStatus, error } = useConnect();
  const { isConnected, address, connector: activeConnector } = useAccount();
  const { disconnect } = useDisconnect();
  const cosmos = useCosmosWallet("cosmos");
  const celestia = useCosmosWallet("celestia");
  const osmosis = useCosmosWallet("osmosis");
  const sui = useSuiWallet();
  const aptos = useAptosWallet();
  const solana = useSolanaWallet();
  const polkadot = usePolkadotWallet();
  const {
    isConnected: loopConnected,
    partyId,
    connect: loopConnect,
    disconnect: loopDisconnect,
    isConnecting: loopConnecting,
    error: loopError,
  } = useCantonWallet();

  const dialogRef = useRef<HTMLDivElement>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [selection, setSelection] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [detectedEvmWallets, setDetectedEvmWallets] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open) return;
    let active = true;
    const detected = new Set(connectors.filter((connector) => connector.type === "injected" && connector.id !== "injected").map((connector) => connector.uid));
    const publish = () => {
      if (active) setDetectedEvmWallets((previous) => previous.size === detected.size && [...detected].every((uid) => previous.has(uid)) ? previous : new Set(detected));
    };
    const onAnnounce = (event: Event) => {
      const rdns = (event as CustomEvent<{ info?: { rdns?: string } }>).detail?.info?.rdns;
      if (!rdns) return;
      for (const connector of connectors) {
        const domains = typeof connector.rdns === "string" ? [connector.rdns] : connector.rdns ?? [];
        if (connector.id === rdns || domains.includes(rdns)) detected.add(connector.uid);
      }
      publish();
    };
    const checkProviders = () => {
      // SDK providers can exist without an installed wallet. Only inspect the
      // injected provider and Safe's embedded-app provider; never request accounts.
      for (const connector of connectors) {
        if (connector.id !== "injected" && connector.type !== "safe") continue;
        if (typeof connector.getProvider !== "function") continue;
        void connector.getProvider().then((provider) => {
          if (provider) detected.add(connector.uid);
          else detected.delete(connector.uid);
          publish();
        }).catch(() => { detected.delete(connector.uid); publish(); });
      }
      window.dispatchEvent(new Event("eip6963:requestProvider"));
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.addEventListener("focus", checkProviders);
    publish();
    checkProviders();
    return () => {
      active = false;
      window.removeEventListener("eip6963:announceProvider", onAnnounce);
      window.removeEventListener("focus", checkProviders);
    };
  }, [open, connectors]);
  const runAction = async (action: () => unknown) => {
    setActionError(null);
    try { await action(); }
    catch (cause) { setActionError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const chooseWallet = (id: string, action: () => unknown) => {
    setPendingId(id);
    void runAction(action).finally(() => setPendingId(null));
  };

  useEffect(() => {
    if (!open) { setPendingId(null); setSelection(null); setActionError(null); }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = dialogRef.current;
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), [tabindex="0"]') ?? [])
      .filter((element) => element.getClientRects().length > 0);
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      // Wallet SDKs may open another dialog above this picker.
      const focusedModal = document.activeElement?.closest('[role="dialog"], wcm-modal, w3m-modal, appkit-modal');
      if (focusedModal && focusedModal !== dialog && !dialog?.contains(focusedModal)) return;
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!first) { event.preventDefault(); dialog?.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || !dialog?.contains(document.activeElement))) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !dialog?.contains(document.activeElement))) {
          event.preventDefault(); first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!open || !selection) return;
    const trigger = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>(`.${styles.chooserNav} button`)?.focus();
    return () => {
      if (trigger?.isConnected && trigger.getClientRects().length) trigger.focus();
    };
  }, [open, selection]);

  if (!open) return null;

  const fullyConnected = loopConnected && (isConnected || cosmos.isConnected || celestia.isConnected || osmosis.isConnected || sui.isConnected || aptos.isConnected || solana.isConnected || polkadot.isConnected);
  const nativeWallets: Array<{ id: CosmosChainKey; label: string; wallet: typeof cosmos }> = [
    { id: "cosmos", label: "Cosmos Hub", wallet: cosmos },
    { id: "celestia", label: "Celestia", wallet: celestia },
    { id: "osmosis", label: "Osmosis", wallet: osmosis },
  ];

  const evmNetworks = [
    ...(networkMode === "testnet" ? [{ id: "ethereum", label: "Ethereum", chain: hoodi }] : []),
    { id: "polygon", label: "Polygon", chain: polygonSettlementChain },
    { id: "monad", label: "Monad", chain: monadEvmChain },
    { id: "bnb", label: "BNB Smart Chain", chain: bnbEvmChain },
  ].filter(({ id }) => id === "ethereum" || isChainEnabled(id as ChainConfig["id"]));
  const cosmosNetworks = nativeWallets.filter(({ id }) => isChainEnabled(id));
  const otherNetworks = [
    { id: "solana", label: "Solana", wallet: solana },
    { id: "sui", label: "Sui", wallet: sui },
    { id: "aptos", label: "Aptos", wallet: aptos },
    { id: "polkadot", label: "Polkadot", wallet: polkadot },
  ].filter(({ id }) => isChainEnabled(id as ChainConfig["id"]));
  const selectedEvm = evmNetworks.find(({ id }) => selection === id);
  const selectedCosmos = cosmosNetworks.find(({ id }) => selection === id);
  const selectedOther = otherNetworks.find(({ id }) => selection === id);
  const selectedLabel = selectedEvm?.label ?? selectedCosmos?.label ?? selectedOther?.label;
  const selectedConnected = selectedEvm ? isConnected : selectedCosmos ? selectedCosmos.wallet.isConnected : selectedOther?.wallet.isConnected ?? false;
  const selectedAddress = selectedEvm ? address : selectedCosmos?.wallet.address ?? selectedOther?.wallet.address;
  // Named browser extensions replace the generic fallback. A configured SDK
  // alone is insufficient; Coinbase must also announce an installed extension.
  const hasNamedBrowserWallet = connectors.some((connector) => connector.id !== "injected" &&
    (connector.type === "injected" || (connector.type === "coinbaseWallet" && detectedEvmWallets.has(connector.uid))));
  const orderedConnectors = connectors.filter((connector) => connector.id !== "injected" || !hasNamedBrowserWallet).sort((a, b) => {
    const rank = (id: string) => /metamask/i.test(id) ? 0 : /injected/i.test(id) ? 1 : /coinbase/i.test(id) ? 2 : /walletconnect/i.test(id) ? 3 : 4;
    return Number(detectedEvmWallets.has(b.uid)) - Number(detectedEvmWallets.has(a.uid)) || rank(a.id) - rank(b.id);
  });
  const toggleSelection = (id: string) => { setActionError(null); setSelection(selection === id ? null : id); };

  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="wallet-dialog-title"
      aria-describedby="wallet-dialog-description" tabIndex={-1}
      className={`wallet-picker-dialog ${styles.overlay}`} data-selected={Boolean(selection)}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className={`${styles.frame} ${styles.mainFrame}`}>
        <span className={styles.frameAccent} aria-hidden="true" />
        <div className={styles.panel}>
          <header className={styles.header}>
            <span className={styles.eyebrow}>// Connect wallets</span>
            <button type="button" onClick={onClose} aria-label="Close" className={styles.close}>
              ESC <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m3 3 14 14M17 3 3 17" stroke="currentColor" strokeWidth="1.4" /></svg>
            </button>
            <h2 id="wallet-dialog-title">Connect your <span>wallets.</span></h2>
            <div className={styles.intro}>
              <p id="wallet-dialog-description">Loop identifies your Canton party and is required for Canton Coin rewards.<br />
                You must also connect at least one wallet from a staking network.</p>
              <span className={styles.headerMotto}>One wallet<br />Many networks<br />More possibilities</span>
            </div>
          </header>

          <section className={styles.step} aria-labelledby="loop-step-title">
            <div className={styles.stepHeading}>
              <span className={styles.stepNumber}>1</span><h3 id="loop-step-title">Required — Loop (Canton)</h3>
              <span className={styles.stepCaption}>Canton network</span>
            </div>
            <div className={styles.loopCard}>
              <div className={styles.loopIdentity}>
                <span className={styles.loopIcon}><svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M24 24c-4-5-7-8-11-8a8 8 0 0 0 0 16c4 0 7-3 11-8s7-8 11-8a8 8 0 0 1 0 16c-4 0-7-3-11-8Z" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" /></svg></span>
                <div className={styles.walletDetails}>
                  <span className={styles.loopName}>Loop Wallet</span>
                  <span className={styles.walletStatus} data-connected={loopConnected} title={partyId ?? undefined}>
                    <i /><span>{loopConnected ? "Connected" : "Not connected"}</span>
                    {loopConnected && partyId && <span className={styles.partyId}>· {partyId.slice(0, 24)}…</span>}
                  </span>
                </div>
              </div>
              <button type="button" className={styles.action} data-ghost={loopConnected} disabled={loopConnecting}
                aria-label={loopConnected ? "Disconnect Loop Wallet" : "Connect Loop Wallet"}
                onClick={() => void runAction(loopConnected ? loopDisconnect : loopConnect)}>
                {loopConnecting ? "Opening…" : loopConnected ? "Disconnect" : "Connect Loop"}
              </button>
            </div>
            <div className={styles.loopNote}>
              <span className={styles.noteIcon} aria-hidden="true">{loopConnected ? "✓" : "i"}</span>
              <p><strong>Required:</strong> Loop Wallet identifies your Canton party. Reward eligibility is verified separately.</p>
            </div>
            {loopError && <p role="alert" className={styles.error}>{loopError}</p>}
          </section>

          <section className={`${styles.step} ${styles.networkStep}`} aria-labelledby="network-step-title">
            <div className={styles.stepHeading}>
              <span className={styles.stepNumber}>2</span><h3 id="network-step-title">Choose at least one network wallet</h3>
              <span className={styles.stepCaption}>Stake across ecosystems</span>
            </div>
            <p className={styles.stepDescription}>Connect one or more wallets from the networks below to start staking.</p>
            <div className={styles.networkLayout}>
              <div className={styles.networkOptions}>
                <Ecosystem kind="evm" title="EVM ecosystem" count={evmNetworks.length}>
                  <div className={`${styles.walletGrid}${evmNetworks.length > 3 ? ` ${styles.otherGrid}` : ""}`}>
                    {evmNetworks.map(({ id, label }) => <WalletCard key={id} id={id} label={label}
                      connected={isConnected} address={address} busy={connectStatus === "pending"}
                      expanded={!isConnected && selection === id}
                      onClick={() => isConnected ? void runAction(() => disconnect()) : toggleSelection(id)} />)}
                  </div>
                  {isConnected && <p className={styles.sharedWallet}>{activeConnector?.name ?? "Your EVM wallet"} is connected across these EVM networks.</p>}
                  {error && <p role="alert" className={styles.error}>{error.message}</p>}
                </Ecosystem>

                <Ecosystem kind="cosmos" title="Cosmos / IBC ecosystem" count={cosmosNetworks.length}>
                  <div className={styles.walletGrid}>
                    {cosmosNetworks.map(({ id, label, wallet }) => <WalletCard key={id} id={id} label={label}
                      connected={wallet.isConnected} address={wallet.address} busy={wallet.isConnecting}
                      expanded={!wallet.isConnected && selection === id}
                      onClick={() => wallet.isConnected ? void runAction(wallet.disconnect) : toggleSelection(id)} />)}
                  </div>
                </Ecosystem>

                <Ecosystem kind="other" title="Other ecosystems" count={otherNetworks.length}>
                  <div className={`${styles.walletGrid} ${styles.otherGrid}`}>
                    {otherNetworks.map(({ id, label, wallet }) => <WalletCard key={id} id={id} label={label}
                      connected={wallet.isConnected} address={wallet.address} busy={wallet.isConnecting}
                      expanded={!wallet.isConnected && selection === id}
                      onClick={() => wallet.isConnected ? void runAction(wallet.disconnect) : toggleSelection(id)} />)}
                  </div>
                </Ecosystem>
              </div>
            </div>
          </section>

          <footer className={styles.footer}>
            <span className={styles.infoIcon} aria-hidden="true">i</span>
            <div><p><strong>Required:</strong> Loop Wallet + at least one network wallet.</p>
              <small>You can connect more later. Private keys never leave your device.</small></div>
            {fullyConnected ? <button type="button" className={styles.action} onClick={onClose}>Done</button>
              : <span className={styles.footerMotto}><b aria-hidden="true">///</b><span>Stake today<br />A more open tomorrow</span></span>}
          </footer>
        </div>
      </div>
      {selection && selectedLabel && <aside className={`${styles.frame} ${styles.chooserFrame}`} aria-label={`${selectedLabel} wallet choices`}>
        <span className={styles.frameAccent} aria-hidden="true" />
        <div className={`${styles.panel} ${styles.walletChooser}`}>
          <div className={styles.chooserNav}>
            <button type="button" onClick={() => setSelection(null)}><span aria-hidden="true">‹</span> Back</button>
            <button type="button" aria-label="Close wallet choices" onClick={() => setSelection(null)}>×</button>
          </div>
          <div className={styles.chooserTitle}>
            <span className={styles.selectedNetworkIcon}><img src={`/networks/${selection}.svg`} alt="" /></span>
            <div><h4>Choose a {selectedLabel} wallet</h4><p>Connect a wallet to stake on {selectedLabel}.</p></div>
          </div>
          <div className={styles.walletInfoBanner}>
            <span aria-hidden="true">ⓘ</span>
            <div><strong>{selection === "ethereum" ? "Lido pool · Hoodi testnet" : loopConnected ? "Loop Wallet (Canton) is already connected ✓" : "Loop Wallet (Canton) is required"}</strong>
              <small>{selection === "ethereum" ? "An EVM wallet is enough for this pool. Canton rewards are not enabled." : loopConnected ? `Now connect a ${selectedLabel} wallet to continue.` : "Connect Loop in the main window, then choose a network wallet."}</small></div>
          </div>
          <div className={styles.walletChoices}>
            {selectedConnected ? <div className={styles.connectedChoice}>
              <span className={styles.connectedDot} />
              <div><strong>Wallet connected</strong><small>{selectedAddress ? `${selectedAddress.slice(0, 9)}…${selectedAddress.slice(-6)}` : selectedLabel}</small></div>
              <button type="button" onClick={() => {
                if (selectedEvm) void runAction(() => disconnect());
                else if (selectedCosmos) void runAction(selectedCosmos.wallet.disconnect);
                else if (selectedOther) void runAction(selectedOther.wallet.disconnect);
              }}>Disconnect</button>
            </div> : selectedEvm ? orderedConnectors.map((connector) => {
              const title = connector.id === "injected" ? "Browser wallet" : connector.name;
              return <WalletOption key={connector.uid} name={title} walletId={connector.id} icon={connector.icon}
                description={connectorBlurb(connector.id) || "Compatible EVM wallet connector"}
                detected={detectedEvmWallets.has(connector.uid)}
                availability={connector.type === "walletConnect" ? "Mobile / QR" : "Not detected"}
                pending={pendingId === connector.uid || connectStatus === "pending"}
                onClick={() => chooseWallet(connector.uid, () => connectAsync({ connector, chainId: selectedEvm.chain.id }))} />;
            }) : selectedCosmos ? selectedCosmos.wallet.wallets.length ? selectedCosmos.wallet.wallets.map((wallet) =>
              <WalletOption key={wallet.id} name={wallet.name} description="Cosmos-compatible browser extension"
                detected pending={pendingId === wallet.id || selectedCosmos.wallet.isConnecting}
                onClick={() => chooseWallet(wallet.id, () => selectedCosmos.wallet.connect(wallet.id))} />)
              : <div className={styles.installHint}>Install <a href="https://www.keplr.app/download" target="_blank" rel="noreferrer">Keplr</a> or <a href="https://www.leapwallet.io/download" target="_blank" rel="noreferrer">Leap Wallet</a>, then reopen the chooser.</div>
            : selectedOther?.id === "sui" ? sui.wallets.length ? sui.wallets.map((wallet) =>
              <WalletOption key={wallet.name} name={wallet.name} icon={wallet.icon} description="Sui Wallet Standard compatible"
                detected={sui.detectedWalletNames.includes(wallet.name)} availability="Web wallet"
                pending={pendingId === wallet.name || sui.isConnecting}
                onClick={() => chooseWallet(wallet.name, () => sui.connect(wallet.name))} />)
              : <div className={styles.installHint}>Install <a href="https://slush.app/download" target="_blank" rel="noreferrer">Slush</a>, Suiet, or another Sui-compatible wallet, then reopen the chooser.</div>
            : selectedOther?.id === "aptos" ? aptos.wallets.length ? aptos.wallets.map((wallet) =>
              <WalletOption key={wallet.name} name={wallet.name} description="Aptos wallet adapter compatible"
                detected={wallet.detected} icon={wallet.icon}
                pending={pendingId === wallet.name}
                onClick={() => chooseWallet(wallet.name, () => aptos.connect(wallet.name))} />)
              : <div className={styles.installHint}>Install Petra or another Aptos-compatible wallet, then reopen the chooser.</div>
            : selectedOther?.id === "solana" ? solana.wallets.length ? solana.wallets.map(({ name, icon, detected }) =>
              <WalletOption key={name} name={name} icon={icon} description="Solana wallet adapter compatible"
                detected={detected}
                pending={pendingId === name || solana.isConnecting}
                onClick={() => chooseWallet(name, () => solana.connect(name))} />)
              : <div className={styles.installHint}>Install Phantom, Solflare, or another Solana Wallet Standard wallet, then reopen the chooser.</div>
            : selectedOther?.id === "polkadot" ? polkadot.accounts.length ? polkadot.accounts.map((account) =>
              <WalletOption key={`${account.source}:${account.address}`} name={account.name} walletId={account.source}
                description={`${account.source} · ${account.address.slice(0, 8)}…${account.address.slice(-6)}`}
                detected
                pending={pendingId === account.address || polkadot.isConnecting}
                onClick={() => chooseWallet(account.address, () => polkadot.connect(account.address))} />)
              : <>
                <button type="button" className={styles.findWallets} disabled={polkadot.isConnecting}
                  onClick={() => chooseWallet("polkadot-discovery", polkadot.discover)}>
                  <WalletIcon name="Polkadot.js" />{polkadot.isConnecting ? "Finding wallets…" : "Find Polkadot wallets"}
                </button>
                <p className={styles.installHint}>Compatible browser extensions include Talisman, SubWallet, and Polkadot.js.</p>
              </>
            : <p className={styles.installHint}>No compatible wallet provider is configured for this network.</p>}
            {selectedCosmos?.wallet.error && <p role="alert" className={styles.error}>{selectedCosmos.wallet.error}</p>}
            {selectedOther?.wallet.error && <p role="alert" className={styles.error}>{selectedOther.wallet.error}</p>}
            {actionError && <p role="alert" className={styles.error}>{actionError}</p>}
          </div>
          <footer className={styles.chooserFooter}><span aria-hidden="true">♙</span><div><strong>Your keys. Your crypto.</strong><small>Private keys stay in your wallet.</small></div><span className={styles.poweredBy}>///<small>Powered by<br />Web3 ecosystems</small></span></footer>
        </div>
      </aside>}
    </div>
  );
}
