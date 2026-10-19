/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx,html}"],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Inter",
          "sans-serif",
        ],
      },
      // Single restrained accent — used sparingly for earned/success states.
      colors: {
        accent: {
          DEFAULT: "#0f7a4d",
          soft: "#e7f4ee",
        },
      },
    },
  },
  plugins: [],
};
