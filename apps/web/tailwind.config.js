/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#1F3864', 50: '#EEF2F9', 100: '#D9E1F2', 600: '#2A4A80', 700: '#1F3864', 800: '#172A4B' },
        accent: { DEFAULT: '#FFD966', 50: '#FFF8E1', 100: '#FFF2CC' },
      },
      fontFamily: { sans: ['Inter', 'ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Arial', 'sans-serif'] },
    },
  },
  plugins: [],
};
