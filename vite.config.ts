import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// The `base` path here matters for GitHub Pages — when the site is served from
// https://<user>.github.io/<repo>/, asset URLs need to be prefixed with /<repo>/.
// Override at build time with VITE_BASE_PATH=/your-repo-name/ if needed.
const base = process.env.VITE_BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [svelte()],
  worker: {
    format: 'es',
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
