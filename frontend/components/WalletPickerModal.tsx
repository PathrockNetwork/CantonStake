"use client";

import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Btn } from "@/components/primitives/Btn";
import { SectionLabel } from "@/components/primitives/SectionLabel";
import { useCantonWallet } from "@/lib/canton";
import { useCosmosWallet } from "@/lib/cosmos/use-cosmos-wallet";
import { useSuiWallet } from "@/lib/sui/use-sui-wallet";
import { tokens } from "@/lib/tokens";

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
  const cosmos = useCosmosWallet();
  const sui = useSuiWallet();

  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) setPendingId(null);
  }, [open]);

  if (!open) return null;

  const fullyConnected = isConnected && loopConnected;

  return (
    <div
      role="dialog"
      aria-modal="true"
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
              className="display"
              style={{ fontSize: 22, margin: "4px 0 0", color: tokens.ink[100] }}
            >
              CantonStake uses two identities.
            </h2>
            <p
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
                : "QR or browser handoff via @fivenorth/loop-sdk"}
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
            className="mono"
            style={{ fontSize: 10, color: tokens.danger, marginTop: 6 }}
          >
            {loopError}
          </div>
        ) : null}

        {/* EVM wallet section */}
        <div style={{ marginTop: 22 }}>
          <SectionLabel>2. EVM (Polygon Amoy)</SectionLabel>
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
              className="mono"
              style={{ fontSize: 10, color: tokens.danger, marginTop: 6 }}
            >
              {error.message}
            </div>
          ) : null}
        </div>

        {/* Cosmos (Keplr / Leap) — only needed if user wants to stake on theta-testnet */}
        <div style={{ marginTop: 22 }}>
          <SectionLabel>3. Cosmos (theta-testnet) · optional</SectionLabel>
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
                Keplr / Leap
              </div>
              <div
                className="mono tabular"
                style={{
                  fontSize: 10,
                  color: tokens.ink[400],
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {cosmos.isConnected
                  ? `${cosmos.address?.slice(0, 14)}…${cosmos.address?.slice(-4)}`
                  : "Browser extension · cosmos1… address"}
              </div>
            </div>
            {cosmos.isConnected ? (
              <Btn size="sm" variant="ghost" onClick={cosmos.disconnect}>
                Disconnect
              </Btn>
            ) : (
              <Btn
                size="sm"
                onClick={() => void cosmos.connect()}
                disabled={cosmos.isConnecting}
              >
                {cosmos.isConnecting ? "Opening…" : "Connect Keplr"}
              </Btn>
            )}
          </div>
          {cosmos.error ? (
            <div
              className="mono"
              style={{ fontSize: 10, color: tokens.danger, marginTop: 6 }}
            >
              {cosmos.error}
            </div>
          ) : null}
        </div>

        {/* Sui (Slush / Suiet) — only needed if user wants to stake on Sui Testnet */}
        <div style={{ marginTop: 22 }}>
          <SectionLabel>4. Sui (testnet) · optional</SectionLabel>
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
                Slush / Suiet / Sui Wallet
              </div>
              <div
                className="mono tabular"
                style={{
                  fontSize: 10,
                  color: tokens.ink[400],
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {sui.isConnected
                  ? `${sui.address?.slice(0, 10)}…${sui.address?.slice(-4)}`
                  : "Detected via @mysten/dapp-kit"}
              </div>
            </div>
            {sui.isConnected ? (
              <Btn size="sm" variant="ghost" onClick={sui.disconnect}>
                Disconnect
              </Btn>
            ) : (
              <Btn
                size="sm"
                onClick={() => void sui.connect()}
                disabled={sui.isConnecting}
              >
                {sui.isConnecting ? "Opening…" : "Connect Sui"}
              </Btn>
            )}
          </div>
          {sui.error ? (
            <div
              className="mono"
              style={{ fontSize: 10, color: tokens.danger, marginTop: 6 }}
            >
              {sui.error}
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
