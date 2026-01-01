import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      input: {
        sidepanel: resolve(__dirname, 'src/pages/sidepanel.html'),
        panel: resolve(__dirname, 'src/pages/panel.html'),
        devtools: resolve(__dirname, 'src/pages/devtools.html'),
        background: resolve(__dirname, 'src/extension/background/index.ts'),
      },
      output: {
        entryFileNames: `assets/[name].js`,
        chunkFileNames: `assets/[name].js`,
        assetFileNames: `assets/[name].[ext]`
      }
    },
  },
})
