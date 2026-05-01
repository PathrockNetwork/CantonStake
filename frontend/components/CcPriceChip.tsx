export function CcPriceChip() {
  return (
    <div className="hairline rounded-full px-3 py-1.5 font-mono text-xxs text-ink-300">
      <span className="text-cc">{"\u25cf"}</span>
      <span className="ml-2">$0.16</span>
      <span className="ml-2 text-neon">{"\u2191"} 2.4%</span>
    </div>
  );
}
