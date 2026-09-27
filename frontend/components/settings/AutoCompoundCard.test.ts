import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoCompoundCard } from "./AutoCompoundCard";
import { networkMode } from "@/lib/network";

// This repository's Vitest JSX transform uses the classic React runtime.
beforeEach(() => vi.stubGlobal("React", React));
afterEach(() => vi.unstubAllGlobals());

function render(options: { status?: "disabled" | "unavailable"; failed?: boolean; canRevoke?: boolean; expired?: boolean } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const statusKey = ["auto-compound-status", networkMode];
  if (options.status || options.failed) {
    client.setQueryData(statusKey, { status: options.failed ? "ready" : options.status,
      executionEnabled: !!options.failed, supportedChains: options.failed ? ["polygon"] : [],
      reason: null, networkMode });
  }
  if (options.failed) client.getQueryCache().find({ queryKey: statusKey })!.setState({ status: "error", error: new Error("offline") });
  client.setQueryData(["auto-compound-permits", "owner"], { permits: [{
    id: "saved", userId: "owner", chain: "polygon", validator: "0xvalidator", enabled: true,
    expiresAt: options.expired ? "2000-01-01T00:00:00Z" : "2099-01-01T00:00:00Z",
  }] });
  try {
    return renderToStaticMarkup(React.createElement(QueryClientProvider, { client },
      React.createElement(AutoCompoundCard, { userId: "owner", canRevoke: options.canRevoke ?? true })));
  } finally { client.clear(); }
}

describe("auto-compound settings", () => {
  it("shows disabled deployment status even with an enabled saved permit and preserves revocation", () => {
    const html = render({ status: "disabled" });
    expect(html).toContain("DISABLED");
    expect(html).toContain("SAVED");
    expect(html).toContain(">Revoke</button>");
    expect(html).not.toMatch(/ARMED|Create permit|Signature is verified/);
  });

  it("does not infer availability while loading or after a failed refresh with stale ready data", () => {
    expect(render()).toContain("CHECKING");
    const failed = render({ failed: true });
    expect(failed).toContain("STATUS UNAVAILABLE");
    expect(failed).toContain("Retry status");
    expect(failed).not.toContain(">AVAILABLE<");
    expect(failed).not.toContain("ARMED");
  });

  it("marks expired permits and disables revocation when the linked wallets are disconnected", () => {
    const html = render({ status: "unavailable", expired: true, canRevoke: false });
    expect(html).toContain("EXPIRED");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Revoke<\/button>/);
    expect(html).toContain("Connect the wallets linked to this profile");
  });
});
