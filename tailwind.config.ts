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
        // Wondish wellness palette — crimson primary on cream surfaces
        primary: {
          DEFAULT: "#812549",
          light: "#B75E78",
          dark: "#5F1C35",
        },
        forest: {
          DEFAULT: "#5F1C35",
          dark: "#4A152A",
          deeper: "#3D1122",
          surface: "#71203F",
        },
        // keep navy alias pointing to forest so dashboard components don't break
        navy: {
          DEFAULT: "#5F1C35",
          dark: "#4A152A",
          deeper: "#3D1122",
          surface: "#71203F",
        },
        surface: "#F9F7ED",
        success: "#00B9A6",
        warning: "#FDC221",
        error: "#EA5455",
        info: "#00B9A6",
      },
      fontFamily: {
        sans: [
          "Inter",
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
          "linear-gradient(135deg, #812549 0%, #5F1C35 50%, #71203F 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
