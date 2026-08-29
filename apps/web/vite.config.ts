import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  optimizeDeps: {
    // MapLibre loads its tile parser as a web worker. Pre-bundling rewrites the
    // worker's path and it then fails to load, which does not raise: the canvas
    // sizes correctly, the background layer paints, and no tile is ever
    // requested. A black map with no error in the console.
    exclude: ['maplibre-gl'],
  },
})
