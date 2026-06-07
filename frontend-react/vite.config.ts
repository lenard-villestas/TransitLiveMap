import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: proxy /api → the FastAPI backend so the browser talks to one origin and
// CORS never enters the picture. Run `python -m uvicorn server:app --reload
// --app-dir backend` alongside `npm run dev`.
// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8000',
    },
  },
})
