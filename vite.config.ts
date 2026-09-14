import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // SPA 폴백은 Vite 기본 appType 'spa'(dev)과 vercel.json rewrite(prod)가 담당 — historyApiFallback은 Vite 옵션이 아니다
  plugins: [
    react(),
  ],
})
