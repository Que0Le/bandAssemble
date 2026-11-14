import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [svelte()],
  // Stamp the build time into the bundle so a stale served build is obvious:
  // the id shows in the header + diagnostics, so two devices on different builds
  // read differently (hard-reload the stale one). UTC, minute precision.
  define: {
    __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ') + ' UTC'),
  },
})
