/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        sb: {
          bg: '#0a0e14',
          panel: '#151b24',
          line: '#2a3544',
          muted: '#8b9aad',
          accent: '#8b5cf6',
          accent2: '#a78bfa',
        },
      },
    },
  },
  plugins: [],
};
