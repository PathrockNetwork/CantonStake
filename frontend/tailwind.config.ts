import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{js,ts,jsx,tsx}",
    "./components/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#0a0a0b",
          900: "#111113",
          850: "#141417",
          800: "#17171a",
          700: "#1e1e22",
          600: "#2a2a30",
          500: "#3a3a42",
          400: "#6a6a75",
          300: "#9a9aa3",
          200: "#cacad0",
          100: "#e8e8ec",
        },
        hairline: {
          DEFAULT: "rgba(255,255,255,0.08)",
          strong: "rgba(255,255,255,0.16)",
        },
        amber: {
          DEFAULT: "#d97706",
          dim: "#a85d05",
          bright: "#f59e0b",
          glow: "#fbbf24",
        },
        neon: {
          DEFAULT: "#00ff9d",
          dim: "rgba(0,255,157,0.12)",
          glow: "rgba(0,255,157,0.40)",
          text: "#001a10",
        },
        cc: {
          DEFAULT: "#F5A623",
          dim: "rgba(245,166,35,0.12)",
          glow: "#fbbf24",
        },
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ef4444",
      },
      fontFamily: {
        display: ['"Instrument Serif"', "Georgia", "serif"],
        sans: ['"Inter"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', '"Fira Code"', "monospace"],
      },
      fontSize: {
        xxs: "0.6875rem",
      },
      borderRadius: {
        none: "0",
      },
      keyframes: {
        "pulse-dot": {
          "0%,100%": { opacity: "1", transform: "scale(1)" },
          "50%": { opacity: ".4", transform: "scale(.85)" },
        },
        ticker: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        spark: {
          "0%": { opacity: "0", transform: "scale(.6)" },
          "30%": { opacity: "1", transform: "scale(1.4)" },
          "100%": { opacity: "0", transform: "scale(2.2)" },
        },
        "flow-dash": {
          to: { strokeDashoffset: "-40" },
        },
        "blink-caret": {
          "0%,49%": { opacity: "1" },
          "50%,100%": { opacity: "0" },
        },
        "fade-up": {
          from: { opacity: "0", transform: "translateY(8px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-dot": "pulse-dot 2s infinite",
        ticker: "ticker 60s linear infinite",
        spark: "spark 1.6s ease-out",
        "flow-dash": "flow-dash 1.4s linear infinite",
        "blink-caret": "blink-caret 1s step-end infinite",
        "fade-up": "fade-up 320ms ease-out",
      },
    },
  },
  plugins: [],
} satisfies Config;
