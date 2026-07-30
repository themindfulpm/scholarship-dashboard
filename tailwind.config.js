/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        repay: {
          primary: '#005DAA',
          secondary: '#00B1E1',
          accent: '#00723A', // darker green
          neutral: '#F2F2F2',
        },
      },
    },
  },
  plugins: [],
}

