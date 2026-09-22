"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Btn } from "@/components/primitives/Btn";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { useCantonWallet } from "@/lib/canton";
import { tokens } from "@/lib/tokens";
import { polygonSettlementChain } from "@/lib/chains";

interface Props {
  open: boolean;
  onClose: () => void;
}

function connectorBlurb(id: string): string {
  switch (id) {
    case "injected":
    case "io.metamask":
    case "metaMaskSDK":
      return "MetaMask, Rabby, Brave, Frame, or any browser-injected wallet";
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

export function WalletPickerModal({ open, onClose }: Props) {
  const { connectors, connectAsync, status: connectStatus, error } = useConnect();
  const { isConnected, address, connector: activeConnector } = useAccount();
  const { disconnect } = useDisconnect();
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

  useEffect(() => {
    if (!open) setPendingId(null);
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

  if (!open) return null;

  const fullyConnected = isConnected && loopConnected;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="wallet-dialog-title"
      aria-describedby="wallet-dialog-description"
      tabIndex={-1}
      className="wallet-picker-dialog"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.78)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        zIndex: 100,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: tokens.ink[900],
          border: `1px solid ${tokens.hairlineStrong}`,
          padding: 24,
          color: tokens.ink[100],
          maxHeight: "90vh",
          overflowY: "auto",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 18,
          }}
        >
          <div>
            <SectionLabel>§ Connect wallets</SectionLabel>
            <h2
              id="wallet-dialog-title"
              className="display"
              style={{ fontSize: 22, margin: "4px 0 0", color: tokens.ink[100] }}
            >
              CantonStake uses two identities.
            </h2>
            <p
              id="wallet-dialog-description"
              className="mono"
              style={{
                fontSize: 11,
                color: tokens.ink[400],
                marginTop: 6,
                lineHeight: 1.6,
              }}
            >
              Loop for your Canton party + CC rewards. EVM for Polygon staking
              signatures. Both stay self-custodial — keys never leave your
              wallet.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="mono"
            style={{
              background: "transparent",
              border: `1px solid ${tokens.hairline}`,
              color: tokens.ink[300],
              padding: "4px 10px",
              fontSize: 11,
              cursor: "pointer",
            }}
          >
            ESC
          </button>
        </div>

        {/* Loop wallet section */}
        <SectionLabel>1. Loop (Canton)</SectionLabel>
        <div
          style={{
            marginTop: 8,
            padding: 14,
            border: `1px solid ${tokens.hairline}`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div
              className="mono"
              style={{ fontSize: 12, color: tokens.ink[100] }}
            >
              Loop Wallet
            </div>
            <div
              className="mono"
              style={{
                fontSize: 10,
                color: tokens.ink[400],
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {loopConnected && partyId
                ? `Connected · ${partyId.slice(0, 24)}…`
                : "Connect securely with your Loop wallet"}
            </div>
          </div>
          {loopConnected ? (
            <Btn size="sm" variant="ghost" onClick={() => void loopDisconnect()}>
              Disconnect
            </Btn>
          ) : (
            <Btn
              size="sm"
              onClick={() => void loopConnect()}
              disabled={loopConnecting}
            >
              {loopConnecting ? "Opening…" : "Connect Loop"}
            </Btn>
          )}
        </div>
        {loopError ? (
          <div
            role="alert"
            className="mono"
            style={{ fontSize: 10, color: tokens.danger, marginTop: 6 }}
          >
            {loopError}
          </div>
        ) : null}

        {/* EVM wallet section */}
        <div style={{ marginTop: 22 }}>
          <SectionLabel>2. EVM · {polygonSettlementChain.name}</SectionLabel>
          {isConnected ? (
            <div
              style={{
                marginTop: 8,
                padding: 14,
                border: `1px solid ${tokens.hairline}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div
                  className="mono"
                  style={{ fontSize: 12, color: tokens.ink[100] }}
                >
                  {activeConnector?.name ?? "Connected"}
                </div>
                <div
                  className="mono tabular"
                  style={{ fontSize: 10, color: tokens.ink[400], marginTop: 2 }}
                >
                  {address
                    ? `${address.slice(0, 6)}…${address.slice(-4)}`
                    : "—"}
                </div>
              </div>
              <Btn size="sm" variant="ghost" onClick={() => disconnect()}>
                Disconnect
              </Btn>
            </div>
          ) : (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexDirection: "column",
                gap: 6,
              }}
            >
              {connectors.map((c) => {
                const isPending =
                  connectStatus === "pending" && pendingId === c.id;
                return (
                  <button
                    key={c.uid}
                    type="button"
                    disabled={connectStatus === "pending"}
                    onClick={async () => {
                      setPendingId(c.id);
                      try {
                        await connectAsync({ connector: c });
                      } catch {
                        // surfaced via `error` below
                      } finally {
                        setPendingId(null);
                      }
                    }}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      padding: 14,
                      border: `1px solid ${tokens.hairline}`,
                      background: "transparent",
                      color: tokens.ink[100],
                      cursor:
                        connectStatus === "pending" ? "wait" : "pointer",
                      textAlign: "left",
                      width: "100%",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div
                        className="mono"
                        style={{ fontSize: 12, color: tokens.ink[100] }}
                      >
                        {c.name}
                      </div>
                      <div
                        className="mono"
                        style={{
                          fontSize: 10,
                          color: tokens.ink[400],
                          marginTop: 2,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {connectorBlurb(c.id)}
                      </div>
                    </div>
                    <span
                      className="mono"
                      style={{ fontSize: 10, color: tokens.ink[400] }}
                    >
                      {isPending ? "…" : "Connect"}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {error ? (
            <div
              role="alert"
              className="mono"
              style={{ fontSize: 10, color: tokens.danger, marginTop: 6 }}
            >
              {error.message}
            </div>
          ) : null}
        </div>

        {fullyConnected ? (
          <div style={{ marginTop: 22 }}>
            <Btn full onClick={onClose}>
              Done
            </Btn>
          </div>
        ) : null}
      </div>
    </div>
  );
}
