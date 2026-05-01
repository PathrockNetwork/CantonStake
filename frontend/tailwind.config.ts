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
          800: "#17171a",
          700: "#1e1e22",
          600: "#2a2a30",
          500: "#3a3a42",
          400: "#6a6a75",
          300: "#9a9aa3",
          200: "#cacad0",
          100: "#e8e8ec",
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
    },
  },
  plugins: [],
} satisfies Config;
