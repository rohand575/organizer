/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: '#F5F5F7',
        surface: '#FFFFFF',
        ink: '#1D1D1F',
        subtle: '#6E6E73',
        hair: '#E5E5EA',
        accent: {
          DEFAULT: '#0A84FF',
          soft: '#E8F1FF',
        },
        note: {
          yellow: '#FEF3C7',
          green: '#DCFCE7',
          blue: '#DBEAFE',
          pink: '#FCE7F3',
          purple: '#EDE9FE',
          orange: '#FFEDD5',
          gray: '#F1F5F9',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"SF Pro Display"',
          '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif',
        ],
      },
      borderRadius: {
        xl: '16px',
        '2xl': '20px',
        '3xl': '28px',
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.06)',
        float: '0 8px 30px rgba(0,0,0,0.12)',
        tab: '0 -1px 20px rgba(0,0,0,0.06)',
      },
      backdropBlur: {
        xs: '2px',
      },
    },
  },
  plugins: [],
}
