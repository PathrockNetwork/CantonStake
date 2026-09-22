"use client";

import Image from "next/image";

/**
 * CantonStake's transparent brand artwork, shared by the site and README.
 */
export function Logo({
  size = 28,
  animated = true,
  className,
}: {
  size?: number;
  animated?: boolean;
  className?: string;
}) {
  return (
    <Image
      src="/brand-mark.png"
      alt=""
      width={size}
      height={size}
      className={className}
      data-animated={animated || undefined}
      unoptimized
      style={{ flexShrink: 0, display: "block", objectFit: "contain" }}
    />
  );
}
