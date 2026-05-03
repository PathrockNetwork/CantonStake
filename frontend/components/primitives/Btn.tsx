"use client";

import Link from "next/link";
import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  CSSProperties,
  ReactNode,
} from "react";
import { tokens } from "@/lib/tokens";

export type BtnVariant = "neon" | "ghost" | "danger";
export type BtnSize = "sm" | "md" | "lg";

const SIZES: Record<BtnSize, CSSProperties> = {
  sm: { padding: "6px 12px", fontSize: 10 },
  md: { padding: "10px 18px", fontSize: 11 },
  lg: { padding: "14px 22px", fontSize: 12 },
};

const VARIANTS: Record<BtnVariant, CSSProperties> = {
  neon: {
    background: tokens.neon,
    color: tokens.neonText,
    border: "none",
  },
  ghost: {
    background: "transparent",
    color: tokens.ink[200],
    border: `1px solid ${tokens.hairline}`,
  },
  danger: {
    background: "transparent",
    color: tokens.danger,
    border: `1px solid ${tokens.danger}`,
  },
};

type CommonProps = {
  children: ReactNode;
  variant?: BtnVariant;
  size?: BtnSize;
  icon?: ReactNode;
  iconRight?: ReactNode;
  full?: boolean;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
};

type AsButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps | "href"> & {
    href?: undefined;
  };

type AsLinkProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps | "href"> & {
    href: string;
  };

export type BtnProps = AsButtonProps | AsLinkProps;

/**
 * Polymorphic CTA primitive. Renders as a Next `Link` when `href` is
 * provided, otherwise as a `<button>`. Avoids the invalid-HTML
 * `<a><button>` nesting that emerges from `<Link><Btn>...</Btn></Link>`.
 */
export function Btn(props: BtnProps) {
  const {
    children,
    variant = "neon",
    size = "md",
    icon,
    iconRight,
    full,
    disabled,
    style,
    className,
    ...rest
  } = props;

  const mergedStyle: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: ".08em",
    cursor: disabled ? "not-allowed" : "pointer",
    transition: "all 160ms",
    width: full ? "100%" : undefined,
    opacity: disabled ? 0.5 : 1,
    borderRadius: 0,
    textDecoration: "none",
    ...SIZES[size],
    ...VARIANTS[variant],
    ...style,
  };

  const merged = `mono ${className ?? ""}`.trim();

  if ("href" in props && props.href != null) {
    const linkProps = rest as AnchorHTMLAttributes<HTMLAnchorElement>;
    return (
      <Link
        {...linkProps}
        href={props.href}
        className={merged}
        style={mergedStyle}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : undefined}
      >
        {icon}
        {children}
        {iconRight}
      </Link>
    );
  }

  return (
    <button
      {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
      disabled={disabled}
      className={merged}
      style={mergedStyle}
    >
      {icon}
      {children}
      {iconRight}
    </button>
  );
}
