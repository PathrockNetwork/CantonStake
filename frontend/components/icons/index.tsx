/**
 * Icon set ported from handoff/prototype/redesign/components.jsx.
 *
 * - Each icon is a thin wrapper around the `I` factory
 * - 14–16px line, 1.4 stroke, currentColor
 * - `IconCoin` is the only exception: a CSS radial-gradient circle, not SVG
 *
 * Keep these visually identical to the prototype. New icons added later
 * must follow the same factory + paths style — do NOT import an icon
 * library.
 */

import type { CSSProperties, ReactNode } from "react";
import { tokens } from "@/lib/tokens";

export type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
};

type IFactoryProps = IconProps & {
  d?: string;
  fill?: string;
  viewBox?: string;
  children?: ReactNode;
};

export function I({
  size = 14,
  color = "currentColor",
  fill = "none",
  strokeWidth = 1.4,
  viewBox = "0 0 16 16",
  d,
  children,
  className,
  style,
}: IFactoryProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={viewBox}
      fill={fill}
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={{ flexShrink: 0, ...style }}
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export const IconHome = (p: IconProps) => (
  <I {...p} d="M2.5 7.2 8 2.8l5.5 4.4v6a.7.7 0 0 1-.7.7H10V9.5H6v4.4H3.2a.7.7 0 0 1-.7-.7v-6Z" />
);

export const IconChart = (p: IconProps) => (
  <I {...p}>
    <path d="M2.5 12.5h11" />
    <path d="m3 10 3-3 2.2 2.1L13 4.3" />
  </I>
);

export const IconShield = (p: IconProps) => (
  <I {...p} d="M8 2.2 13 4v3.2c0 3-1.9 5.2-5 6.6-3.1-1.4-5-3.6-5-6.6V4l5-1.8Z" />
);

export const IconGear = (p: IconProps) => (
  <I {...p}>
    <path d="M6.9 2.4h2.2l.4 1.5c.4.1.8.3 1.1.5l1.4-.8 1.1 1.9-1.1 1.1c.1.4.1.8 0 1.2l1.1 1.1-1.1 1.9-1.4-.8c-.3.2-.7.4-1.1.5l-.4 1.5H6.9l-.4-1.5c-.4-.1-.8-.3-1.1-.5l-1.4.8-1.1-1.9L4 7.8a4.6 4.6 0 0 1 0-1.2L2.9 5.5 4 3.6l1.4.8c.3-.2.7-.4 1.1-.5l.4-1.5Z" />
    <circle cx="8" cy="7.6" r="1.8" fill="none" stroke="currentColor" />
  </I>
);

export const IconBolt = (p: IconProps) => (
  <I {...p} d="M9 2 4 9h3l-1 5 5-7H8l1-5Z" />
);

export const IconArrowRight = (p: IconProps) => (
  <I {...p}>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </I>
);

export const IconChevronRight = (p: IconProps) => (
  <I {...p} d="M6 4l4 4-4 4" />
);

export const IconCheck = (p: IconProps) => (
  <I {...p} d="M3 8.5 6.5 12 13 4.5" />
);

export const IconClock = (p: IconProps) => (
  <I {...p}>
    <circle cx="8" cy="8" r="5.5" fill="none" />
    <path d="M8 5v3l2 2" />
  </I>
);

export const IconLock = (p: IconProps) => (
  <I {...p}>
    <rect x="3" y="7" width="10" height="6.5" fill="none" stroke="currentColor" />
    <path d="M5 7V5a3 3 0 0 1 6 0v2" />
  </I>
);

export const IconExternal = (p: IconProps) => (
  <I {...p}>
    <path d="M6 3H3v10h10v-3M9 3h4v4M13 3 7 9" />
  </I>
);

/**
 * The Canton Coin glyph — radial gradient, NOT an SVG. Keep it as a
 * styled span so the gold gradient renders crisp at any size.
 */
export function IconCoin({ size = 14, className, style }: IconProps) {
  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "50%",
        background: `radial-gradient(circle at 35% 30%, #ffd97a, ${tokens.cc} 60%, #b87a13)`,
        boxShadow: `0 0 8px ${tokens.ccDim}`,
        flexShrink: 0,
        ...style,
      }}
    />
  );
}
