import type { Metadata } from "next";
import "./globals.css";
import "./home.css";
import "./account.css";
import { Providers } from "./providers";
import { TopNav } from "@/components/chrome/TopNav";
import { isMainnet } from "@/lib/network";
import { GlobalLiveTrace } from "@/components/trace/GlobalLiveTrace";
import { AccountPreferences } from "@/components/account/AccountPreferences";

export const metadata: Metadata = {
  metadataBase: new URL(isMainnet ? "https://cantonstake.pathrocknetwork.org" : "https://testnet.cantonstake.pathrocknetwork.org"),
  title: "CantonStake — Canton-Native Delegation",
  description:
    "Canton-native staking for Polygon. Delegate POL from your own wallet and earn native yield plus Canton Coin rewards.",
  icons: {
    icon: [
      { url: "/favicon.ico?v=3", sizes: "32x32", type: "image/x-icon" },
      { url: "/favicon-32.png?v=3", sizes: "32x32", type: "image/png" },
      { url: "/favicon-64.png?v=3", sizes: "64x64", type: "image/png" },
      { url: "/icon.png?v=3", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon.ico?v=3",
    apple: { url: "/apple-icon.png?v=3", sizes: "180x180", type: "image/png" },
  },
  openGraph: {
    type: "website",
    images: [{
      url: "/og-image.png",
      width: 1200,
      height: 630,
      alt: "CantonStake",
    }],
  },
  twitter: {
    card: "summary_large_image",
    images: ["/og-image.png"],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/jetbrains-mono-latin.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <Providers>
          <AccountPreferences />
          <a className="skip-link" href="#main-content">Skip to content</a>
          <TopNav />
          {/*
            No outer container here. Each ported screen owns its own
            max-width / padding (the prototype uses 1280–1440px max with
            screen-specific paddings). Un-ported screens will look
            edge-to-edge until Step 6 ports them.
          */}
          <div id="main-content" tabIndex={-1}>{children}</div>
          <GlobalLiveTrace />
        </Providers>
      </body>
    </html>
  );
}
