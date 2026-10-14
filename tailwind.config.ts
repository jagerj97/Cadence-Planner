import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./client/android.html", "./client/src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      // About 1px larger than Tailwind's defaults at each size, for easier reading on a phone.
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.125rem" }],
        sm: ["0.9375rem", { lineHeight: "1.375rem" }],
        base: ["1.0625rem", { lineHeight: "1.625rem" }],
        lg: ["1.1875rem", { lineHeight: "1.75rem" }],
        xl: ["1.3125rem", { lineHeight: "1.875rem" }],
        "2xl": ["1.5625rem", { lineHeight: "2rem" }],
      },
      borderRadius: { lg: ".5625rem", md: ".375rem", sm: ".25rem", xs: ".1875rem" },
      colors: {
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        card: { DEFAULT: "hsl(var(--card) / <alpha-value>)", foreground: "hsl(var(--card-foreground) / <alpha-value>)" },
        popover: { DEFAULT: "hsl(var(--popover) / <alpha-value>)", foreground: "hsl(var(--popover-foreground) / <alpha-value>)" },
        primary: { DEFAULT: "hsl(var(--primary) / <alpha-value>)", foreground: "hsl(var(--primary-foreground) / <alpha-value>)", border: "var(--primary-border)" },
        secondary: { DEFAULT: "hsl(var(--secondary) / <alpha-value>)", foreground: "hsl(var(--secondary-foreground) / <alpha-value>)" },
        muted: { DEFAULT: "hsl(var(--muted) / <alpha-value>)", foreground: "hsl(var(--muted-foreground) / <alpha-value>)" },
        accent: { DEFAULT: "hsl(var(--accent) / <alpha-value>)", foreground: "hsl(var(--accent-foreground) / <alpha-value>)" },
        destructive: { DEFAULT: "hsl(var(--destructive) / <alpha-value>)", foreground: "hsl(var(--destructive-foreground) / <alpha-value>)", border: "var(--destructive-border)" },
        ring: "hsl(var(--ring) / <alpha-value>)",
        sidebar: { DEFAULT: "hsl(var(--sidebar) / <alpha-value>)", accent: "hsl(var(--sidebar-accent) / <alpha-value>)" },
      },
      fontFamily: { sans: ["var(--font-sans)"], mono: ["var(--font-mono)"] },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
