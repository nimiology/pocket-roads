import { defineConfig } from 'vite';

/** Identifies this build; the running game compares it with the deployed version.json to spot updates. */
const BUILD_ID = new Date().toISOString();

// Production builds are served from GitHub Pages under /pocket-roads/.
export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? '/pocket-roads/' : '/',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [{
    name: 'version-file',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  }],
}));
