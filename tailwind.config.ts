import type { Config } from 'tailwindcss'
import colors from 'tailwindcss/colors'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Cairo', 'Segoe UI', 'Tahoma', 'sans-serif'],
      },
      colors: {
        primary: colors.amber,
        surface: colors.stone,
        success: colors.emerald,
        danger: colors.red,
        warning: colors.orange,
        info: colors.sky,
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(28 25 23 / 0.06), 0 1px 3px 0 rgb(28 25 23 / 0.08)',
        fab: '0 4px 12px rgb(28 25 23 / 0.25)',
      },
    },
  },
  plugins: [],
} satisfies Config
