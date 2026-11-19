import react from '@vitejs/plugin-react'
import wasm from 'vite-plugin-wasm'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Rapier (non-compat) imports its .wasm as an ES module.
  plugins: [react(), wasm()],
  build: {
    target: 'es2022',
  },
  // Expose the dev server on the LAN to test on a real phone.
  server: { host: true },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Rapier only declares `module`: point Node at it and let Vite (and the wasm plugin) transform it.
    alias: { '@dimforge/rapier3d': '@dimforge/rapier3d/rapier.js' },
    server: { deps: { inline: ['@dimforge/rapier3d'] } },
  },
})
