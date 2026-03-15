/** @type {import('tailwindcss').Config} */
const config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: "#e50914",
          dark: "#b20710",
        },
        cinema: "#050505",
      },
      backgroundImage: {
        "gradient-hero":
          "linear-gradient(to right, rgba(0,0,0,0.9) 30%, transparent 70%), linear-gradient(to top, #050505 0%, transparent 30%)",
      },
      keyframes: {
        "fade-in": { from: { opacity: "0", transform: "translateX(-50%) translateY(-8px)" }, to: { opacity: "1", transform: "translateX(-50%) translateY(0)" } },
        "scale-in": { from: { opacity: "0", transform: "scale(0.6)" }, to: { opacity: "1", transform: "scale(1)" } },
        "toast-in": { from: { opacity: "0", transform: "translateY(-8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
      },
      animation: {
        "fade-in": "fade-in 0.25s ease-out",
        "scale-in": "scale-in 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards",
        "toast-in": "toast-in 0.2s ease-out",
      },
    },
  },
};

module.exports = config;
