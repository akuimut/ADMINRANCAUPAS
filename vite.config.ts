import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  base: mode === 'android' ? './' : '/ADMINRANCAUPAS/',
  plugins: [react(), tailwindcss()],
}))
