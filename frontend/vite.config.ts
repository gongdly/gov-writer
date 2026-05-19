import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// =============================================================================
// Vite 설정
// =============================================================================
// 핵심:
//   - 빌드 산출물을 frontend/dist가 아닌 ../static에 출력
//   - FastAPI가 그 static을 그대로 서빙
//   - 개발 시 /api 경로는 백엔드(8000)로 프록시
// =============================================================================

export default defineConfig({
  plugins: [react()],

  // 빌드 산출물 위치 — 루트의 static/
  build: {
    outDir: resolve(__dirname, '../static'),
    emptyOutDir: true,
    sourcemap: false,
  },

  // 개발 서버
  server: {
    port: 5173,
    proxy: {
      // /api/* 요청은 FastAPI(8000)로 프록시
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
