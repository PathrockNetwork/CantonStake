import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";
import { TopNav } from "@/components/TopNav";

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
          <main className="max-w-6xl mx-auto px-6 py-12">{children}</main>
          <footer className="hairline-t mt-20 py-6 text-center text-xs text-ink-400 font-mono">
            CANTONSTAKE · HACKATHON MVP · BUILT FOR CANTON NETWORK
          </footer>
        </Providers>
      </body>
    </html>
  );
}
