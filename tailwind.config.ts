import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./data/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: "#4ade80",
          light: "#86efac",
          dark: "#22c55e",
        },
        forest: {
          DEFAULT: "#1e3422",
          dark: "#152718",
          deeper: "#0d1a10",
          surface: "#263b2a",
        },
        // keep navy alias pointing to forest so dashboard components don't break
        navy: {
          DEFAULT: "#1e3422",
          dark: "#152718",
          deeper: "#0d1a10",
          surface: "#263b2a",
        },
        surface: "#f4faf5",
        success: "#28C76F",
        warning: "#FF9F43",
        error: "#EA5455",
        info: "#00CFE8",
      },
      fontFamily: {
        sans: [
          "Public Sans",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
      },
      animation: {
        "fade-in": "fadeIn 0.5s ease-in-out",
        "slide-up": "slideUp 0.5s ease-out",
        pulse: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(20px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(var(--tw-gradient-stops))",
        "hero-pattern":
          "linear-gradient(135deg, #1e3422 0%, #0d1a10 50%, #152718 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
