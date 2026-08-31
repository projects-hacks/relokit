import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  // Commands use the workspace env file. Browser code receives only explicitly
  // public variables; tenant credentials remain in the server-side proxy.
  envDir: '../..',
  envPrefix: 'VITE_PUBLIC_',
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://127.0.0.1:8787' } },
  build: {
    // No manual chunking for maplibre. Collapsing it into one chunk swallows
    // the entry its web worker is built from, so the worker file is never
    // emitted and the deployed map renders blank while the dev server, which
    // does not bundle, looks perfect.
  },
  optimizeDeps: {
    // MapLibre loads its tile parser as a web worker. Pre-bundling rewrites the
    // worker's path and it then fails to load, which does not raise: the canvas
    // sizes correctly, the background layer paints, and no tile is ever
    // requested. A black map with no error in the console.
    exclude: ['maplibre-gl'],
  },
})
