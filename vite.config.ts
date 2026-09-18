import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  // SPA 폴백은 Vite 기본 appType 'spa'(dev)과 vercel.json rewrite(prod)가 담당 — historyApiFallback은 Vite 옵션이 아니다
  plugins: [
    react(),
  ],
  resolve: {
    // tsconfig.app.json의 paths와 짝. vitest도 이 설정을 읽으므로 테스트에서도 @/ 가 통한다.
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
})
