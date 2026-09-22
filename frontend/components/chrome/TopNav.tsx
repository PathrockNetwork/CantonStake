"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import { CCRoundTicker } from "@/components/chrome/CCRoundTicker";
import { PriceTape } from "@/components/chrome/PriceTape";
import { Disclosure } from "./Disclosure";
import { useWalletPicker } from "@/components/WalletPickerProvider";
import { I, IconChart, IconGear, IconHome } from "@/components/icons";
import { Logo } from "@/components/primitives/Logo";
import { useCantonWallet } from "@/lib/canton";
import { isMainnet, networkMode } from "@/lib/network";

const IconStake = () => <I><path d="m3 6 5-3 5 3-5 3-5-3Z" /><path d="m3 9 5 3 5-3M3 12l5 3 5-3" /></I>;
const IconPositions = () => <I><path d="M2.5 13.5V8.5h2v5h-2ZM7 13.5V3.5h2v10H7ZM11.5 13.5V6h2v7.5h-2Z" /></I>;
const IconRewards = () => <I><path d="M4.5 3h7v2.2a3.5 3.5 0 0 1-7 0V3Z" /><path d="M4.5 4H2.7v1.2c0 1.5 1 2.5 2.4 2.7M11.5 4h1.8v1.2c0 1.5-1 2.5-2.4 2.7M8 8.7V12M5.5 13h5" /></I>;
const IconDashboard = () => <I><rect x="2.5" y="2.5" width="4" height="4" /><rect x="9.5" y="2.5" width="4" height="4" /><rect x="2.5" y="9.5" width="4" height="4" /><rect x="9.5" y="9.5" width="4" height="4" /></I>;
const IconPortfolio = () => <I><path d="M8 2.5v5.4h5.5A5.5 5.5 0 1 1 8 2.5Z" /><path d="M10 2.8a4.7 4.7 0 0 1 3.2 3.1H10V2.8Z" /></I>;
const IconAbout = () => <I><circle cx="8" cy="8" r="5.5" /><path d="M8 7v4M8 4.7h.01" /></I>;
const IconWallet = () => <I><path d="M2.5 4.5h9.7a1.3 1.3 0 0 1 1.3 1.3v6.3H3.8a1.3 1.3 0 0 1-1.3-1.3V4.5Z" /><path d="M3.5 4.5V3.3h8M10.5 8h3v2h-3a1 1 0 1 1 0-2Z" /></I>;

const NAV = [
  { href: "/", label: "Home", icon: <IconHome /> },
  { href: "/stake", label: "Stake", icon: <IconStake /> },
  { href: "/positions", label: "Positions", icon: <IconPositions /> },
  { href: "/rewards", label: "Rewards", icon: <IconRewards /> },
  { href: "/analytics", label: "Analytics", icon: <IconChart /> },
];
const MORE = [
  { href: "/dashboard", label: "Dashboard", icon: <IconDashboard /> },
  { href: "/portfolio", label: "Portfolio", icon: <IconPortfolio /> },
  { href: "/settings", label: "Settings", icon: <IconGear /> },
  { href: "/#how-it-works", label: "About", icon: <IconAbout /> },
];

function routeActive(pathname: string | null, href: string) {
  if (href === "/") return pathname === "/";
  if (href.includes("#")) return false;
  return pathname?.startsWith(href) ?? false;
}

export function TopNav() {
  const pathname = usePathname();
  const { address, isConnected } = useAccount();
  const { partyId, isConnected: loopConnected } = useCantonWallet();
  const { openPicker } = useWalletPicker();
  const connected = isConnected && loopConnected;
  const moreActive = MORE.some((item) => routeActive(pathname, item.href));

  return (
    <header className={`site-header site-header--${networkMode}`}>
      <div className="site-header__bar">
        <Link href="/" className="site-brand" aria-label="CantonStake home">
          <Logo size={34} animated={false} />
          <span className="display">CantonStake</span>
        </Link>
        <nav className="site-nav" aria-label="Primary navigation">
          {NAV.map((item) => {
            const active = routeActive(pathname, item.href);
            return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`mono site-nav__link${active ? " site-nav__link--active" : ""}`}>{item.icon}{item.label}</Link>;
          })}
          <span className="site-nav__extended" aria-label="Account navigation">
            {MORE.map((item) => {
              const active = routeActive(pathname, item.href);
              return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`mono site-nav__link${active ? " site-nav__link--active" : ""}`}>{item.icon}{item.label}</Link>;
            })}
          </span>
          <Disclosure className="site-nav__more" key={pathname} label="More" active={moreActive}>
            {MORE.map((item) => <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>{item.label}</Link>)}
          </Disclosure>
        </nav>
        <div className="site-header__wallets">
          <div className="site-header__round"><CCRoundTicker compact /></div>
          <Disclosure className="network-switch site-header__network" label={<><span className="network-switch__dot" aria-hidden="true" />{networkMode}<span className="network-switch__funds">{isMainnet ? "REAL FUNDS" : "SANDBOX"}</span></>}>
            <a href="https://cantonstake.pathrocknetwork.org/" aria-current={isMainnet ? "page" : undefined}>Mainnet <small>Real funds</small></a>
            <a href="https://testnet.cantonstake.pathrocknetwork.org/" aria-current={!isMainnet ? "page" : undefined}>Testnet <small>Explore with test tokens</small></a>
          </Disclosure>
          <button className="site-wallet-button mono" type="button" onClick={openPicker} title={connected ? `EVM ${address} · Canton ${partyId}` : "Connect your EVM and Canton wallets"}><IconWallet />{connected ? "Manage wallets" : isConnected || loopConnected ? "Finish connecting" : "Connect wallets"}{connected && <i />}</button>
        </div>
      </div>
      <PriceTape />
      {isMainnet && pathname !== "/" ? <div className="mainnet-ribbon mono" role="status">MAINNET · REAL FUNDS · TRANSACTIONS CANNOT BE UNDONE</div> : null}
    </header>
  );
}
