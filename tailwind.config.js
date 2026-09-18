/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // 원천은 src/index.css :root의 CSS 변수. 값은 거기서만 바꾼다.
        // <alpha-value> 덕에 bg-mint-500/30 같은 투명도 수식어가 그대로 동작한다.
        mint: {
          50:  'rgb(var(--mint-50) / <alpha-value>)',
          100: 'rgb(var(--mint-100) / <alpha-value>)',
          200: 'rgb(var(--mint-200) / <alpha-value>)',
          500: 'rgb(var(--mint-500) / <alpha-value>)',
          600: 'rgb(var(--mint-600) / <alpha-value>)',
          800: 'rgb(var(--mint-800) / <alpha-value>)',
          900: 'rgb(var(--mint-900) / <alpha-value>)',
        },
        // 외부 브랜드색 — 테마가 바뀌어도 고정이라 CSS 변수 없이 헥스로 둔다
        kakao: '#FEE500',
        naver: '#03C75A',
      },
    },
  },
  plugins: [],
}
