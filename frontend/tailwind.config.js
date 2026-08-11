/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Neutral ink scale — true greys, no blue cast, so red is the only
        // hue in the interface. 900/950 carry the black half of the palette.
        ink: {
          50: '#f8f8f8',
          100: '#f0f0f0',
          200: '#e3e3e3',
          300: '#c7c7c7',
          400: '#9b9b9b',
          500: '#767676',
          600: '#575757',
          700: '#3e3e3e',
          800: '#262626',
          900: '#151515',
          950: '#0a0a0a',
        },
        // Brand red, sampled from the mark. Used for the logo, primary
        // actions, active nav and focus rings — nothing else.
        brand: {
          50: '#fef2f2',
          100: '#fde3e4',
          200: '#fbcbcd',
          300: '#f7a1a5',
          400: '#f26c72',
          500: '#ed2a31',
          600: '#d81f26',
          700: '#b3181e',
          800: '#8f1418',
          900: '#751416',
        },
        // Statuses stay semantically distinct on purpose: eight booking
        // states have to be told apart at a glance, and a red/black/white
        // dashboard where every badge looks alike is pretty but unusable.
        // They are desaturated so they read as information, not decoration.
        success: { 50: '#f0fdf4', 100: '#dcfce7', 600: '#16794c', 700: '#125e3c' },
        warning: { 50: '#fffbeb', 100: '#fef3c7', 600: '#a16207', 700: '#854d0e' },
        // Deliberately deeper and browner than `brand` so a destructive
        // action never reads as the primary one.
        danger: { 50: '#fdf3f2', 100: '#fbe4e2', 600: '#a32218', 700: '#851b13' },
        info: { 50: '#f0f6ff', 100: '#dbeafe', 600: '#2c5fa8', 700: '#234b85' },
      },
      fontFamily: {
        sans: [
          'Inter',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      borderRadius: {
        card: '0.875rem',
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(16 24 40 / 0.04), 0 1px 3px 0 rgb(16 24 40 / 0.06)',
        raised: '0 4px 12px -2px rgb(16 24 40 / 0.08), 0 2px 4px -2px rgb(16 24 40 / 0.04)',
        overlay: '0 20px 40px -12px rgb(16 24 40 / 0.22)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'slide-up': {
          from: { opacity: 0, transform: 'translateY(6px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'slide-up': 'slide-up 160ms ease-out',
      },
    },
  },
  plugins: [],
}
