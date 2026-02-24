/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
  ],
  theme: {
    extend: {
      // 1. ADD: Custom backdropBlur utility for the core glass effect
      backdropBlur: {
        glass: '10px',
      },
      // 2. ADD: Custom border color (semi-transparent white)
      borderColor: {
        'glass-border': 'rgba(255, 255, 255, 0.2)',
      },
      colors: {
        // UPDATE: Dark background color for contrast
        bg: '#0a1930', 
        // 3. ADD: Semi-transparent white for the cards (rgba(255, 255, 255, 0.15))
        'glass-white': 'rgba(255, 255, 255, 0.15)', 
        // White foreground text
        fg: '#ffffff', 
        // Light gray muted text
        muted: '#9ca3af', 
        border: '#475569', 
        primary: {
          DEFAULT: '#0ea5e9',
          600: '#000000',     // <-- CHANGED: Used to be '#0284c7', now Black
        },
      },
      boxShadow: {
        sm: '0 1px 2px rgba(16,24,40,.06)',
        md: '0 2px 6px rgba(16,24,40,.08)',
        // 4. ADD: Custom shadow for the glass effect
        'glass': '0 4px 30px rgba(0, 0, 0, 0.2)', 
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        // Update: Larger radius for the card corners
        lg: '16px', 
      },
      fontFamily: {
        sans: [
          'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'Helvetica Neue', 'Arial', 'sans-serif'
        ],
      },
      spacing: {
        1.5: '6px',
        5.5: '22px',
      },
      screens: {
        'xs': '480px',
      },
      container: {
        center: true,
        padding: '16px',
      }
    },
  },
  plugins: [],
};