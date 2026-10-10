/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        discord: {
          dark: '#313338',
          darker: '#2b2d31',
          darkest: '#1e1f22',
          amoled: '#111214',
          blurple: '#5865f2',
          'blurple-hover': '#4752c4',
          'blurple-active': '#3c45a5',
          green: '#23a55a',
          'green-hover': '#1f9250',
          yellow: '#f0b232',
          red: '#f23f43',
          'red-hover': '#da373c',
          text: '#dbdee1',
          'text-muted': '#949ba4',
          'text-header': '#f2f3f5',
          border: '#3f4147'
        }
      },
      fontFamily: {
        discord: ['gg sans', 'Noto Sans', 'Helvetica Neue', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace']
      }
    },
  },
  plugins: [],
}
