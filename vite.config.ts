import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: { alias: { '@engine': r('./src/engine'), '@data': r('./src/data'), '@game': r('./src/game') } },
  // assets/ holds generated art & audio; served as static files
  publicDir: 'assets',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  // Never expose non-VITE_ env vars (the asset API key lives in .env for build scripts only)
  envPrefix: 'VITE_',
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as never);
