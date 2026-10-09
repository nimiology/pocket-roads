import { defineConfig } from 'vite';

// Production builds are served from GitHub Pages under /pocket-roads/.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/pocket-roads/' : '/',
}));
