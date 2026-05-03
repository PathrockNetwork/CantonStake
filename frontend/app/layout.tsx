import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { TopNav } from "@/components/chrome/TopNav";
import { GlobalLiveTrace } from "@/components/trace/GlobalLiveTrace";

export const metadata: Metadata = {
  title: "CantonStake — Canton-Native Delegation",
  description:
    "Delegate POL on Polygon and earn Canton Coin activity rewards through on-ledger attestations.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <TopNav />
          {/*
            No outer container here. Each ported screen owns its own
            max-width / padding (the prototype uses 1280–1440px max with
            screen-specific paddings). Un-ported screens will look
            edge-to-edge until Step 6 ports them.
          */}
          {children}
          <GlobalLiveTrace />
        </Providers>
      </body>
    </html>
  );
}
