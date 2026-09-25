import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/** dev-only: POST /__snap?name=x with a PNG data URL body → .cache/snaps/x.png (full-resolution QA captures) */
function snapPlugin(): Plugin {
  return {
    name: 'dev-snap',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__snap', (req, res) => {
        const url = new URL(req.url ?? '', 'http://x');
        const name = (url.searchParams.get('name') ?? 'snap').replace(/[^\w-]/g, '');
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          fs.mkdirSync(r('./.cache/snaps'), { recursive: true });
          const b64 = body.replace(/^data:image\/\w+;base64,/, '');
          fs.writeFileSync(r(`./.cache/snaps/${name}.png`), Buffer.from(b64, 'base64'));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [snapPlugin()],
  resolve: { alias: { '@engine': r('./src/engine'), '@data': r('./src/data'), '@game': r('./src/game') } },
  // assets/ holds generated art & audio; served as static files
  publicDir: 'assets',
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  optimizeDeps: { esbuildOptions: { target: 'es2022' } },
  esbuild: { target: 'es2022' },
  // Never expose non-VITE_ env vars (the asset API key lives in .env for build scripts only)
  envPrefix: 'VITE_',
  server: { watch: { ignored: ['**/.cache/**', '**/art-src/**'] } },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
} as never);
