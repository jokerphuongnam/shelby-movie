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
    },
  },
};

module.exports = config;
