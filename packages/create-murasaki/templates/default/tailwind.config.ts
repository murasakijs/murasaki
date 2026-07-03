import type { Config } from 'tailwindcss'

export default {
  presets: [require('@murasakijs/ui/tailwind-preset')],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    './node_modules/@murasakijs/ui/dist/**/*.js',
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        murasaki: {
          bright: '#a855f7',
          deep: '#5b21b6',
          dark: '#3b0764',
        },
      },
    },
  },
} satisfies Config
