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
          <main className="mx-auto max-w-7xl px-8 py-10">{children}</main>
          <footer className="hairline-t mt-20 py-6 text-center text-xs text-ink-400 font-mono">
            CANTONSTAKE · HACKATHON MVP · BUILT FOR CANTON NETWORK
          </footer>
        </Providers>
      </body>
    </html>
  );
}
