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
          DEFAULT: "#7367F0",
          light: "#8479F2",
          dark: "#655BD3",
        },
        navy: {
          DEFAULT: "#25293C",
          dark: "#1a1d2e",
          deeper: "#13151f",
          surface: "#2F3349",
        },
        surface: "#F8F7FA",
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
          "linear-gradient(135deg, #25293C 0%, #1a1d2e 50%, #25293C 100%)",
      },
    },
  },
  plugins: [],
};

export default config;
