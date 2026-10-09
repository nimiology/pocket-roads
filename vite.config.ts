import { defineConfig } from 'vite';

/** Identifies this build; the running game compares it with the deployed version.json to spot updates. */
const BUILD_ID = new Date().toISOString();

// Served from the domain root (Vercel, local dev) unless BASE_PATH says otherwise:
// the GitHub Pages workflow sets BASE_PATH=/pocket-roads/.
export default defineConfig(() => ({
  base: process.env.BASE_PATH || '/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [{
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  }],
}));
