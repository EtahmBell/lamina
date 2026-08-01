import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    const apiBaseUrl = loadEnv(mode, process.cwd(), '').VITE_API_BASE_URL?.trim()
    if (!apiBaseUrl) {
      throw new Error('VITE_API_BASE_URL must be configured for a production frontend build.')
    }
    if (!apiBaseUrl.startsWith('https://')) {
      throw new Error('VITE_API_BASE_URL must use HTTPS in a production frontend build.')
    }
  }

  return { plugins: [react(), tailwindcss()] }
})
