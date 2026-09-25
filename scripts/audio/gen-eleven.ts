/**
 * Generate the audio listed in docs/音频生成提示词.md with ElevenLabs (build-time only; key from .env).
 *   npx tsx scripts/audio/gen-eleven.ts [--only=sfx,music,amb] [--ids=burn,heal] [--force] [--dry]
 * Writes art-src/audio/gen/<file>; existing files are skipped unless --force. Then run `npm run audio:import`.
 */
import fs from 'node:fs';
import path from 'node:path';
import 'dotenv/config';

const KEY = process.env.ELEVENLABS_API_KEY;
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const only = args.only ? new Set(args.only.split(',')) : null;
const ids = args.ids ? new Set(args.ids.split(',')) : null;
const OUT = 'art-src/audio/gen';
fs.mkdirSync(OUT, { recursive: true });

interface Job { file: string; kind: 'sfx' | 'music' | 'amb'; seconds: number; prompt: string }

// rows look like: | `burn.mp3` | 灼烧跳伤 | 0.5–0.8 s | <prompt> |
const doc = fs.readFileSync('docs/音频生成提示词.md', 'utf8');
const jobs: Job[] = [];
for (const line of doc.split('\n')) {
  const m = /^\|\s*`([\w]+\.mp3)`\s*\|[^|]*\|\s*([^|]+)\|\s*(.+?)\s*\|\s*$/.exec(line);
  if (!m) continue;
  const [, file, dur, prompt] = m as unknown as [string, string, string, string];
  const kind = file.startsWith('music_') ? 'music' : file.startsWith('amb_') ? 'amb' : 'sfx';
  const nums = [...dur.matchAll(/[\d.]+/g)].map((x) => Number(x[0]));
  const max = Math.max(...nums);
  const seconds = kind === 'music' ? (/min/.test(dur) ? Math.min(max, 3) * 60 : max) : kind === 'amb' ? 30 : Math.min(max, 30);
  jobs.push({ file, kind, seconds, prompt });
}
const todo = jobs.filter((j) => (!only || only.has(j.kind)) && (!ids || ids.has(j.file.replace(/\.mp3$/, ''))) && (args.force === 'true' || !fs.existsSync(path.join(OUT, j.file))));
console.log(`jobs ${jobs.length} · todo ${todo.length}: ${todo.map((j) => `${j.file}(${j.seconds}s)`).join(' ')}`);
if (args.dry === 'true') process.exit(0);
if (!KEY) throw new Error('ELEVENLABS_API_KEY missing in .env');

async function gen(j: Job): Promise<Buffer> {
  const headers = { 'xi-api-key': KEY!, 'Content-Type': 'application/json' };
  const res = j.kind === 'music'
    ? await fetch('https://api.elevenlabs.io/v1/music', { method: 'POST', headers, body: JSON.stringify({ prompt: j.prompt, music_length_ms: Math.round(j.seconds * 1000) }), signal: AbortSignal.timeout(10 * 60_000) })
    : await fetch('https://api.elevenlabs.io/v1/sound-generation', {
      method: 'POST', headers, signal: AbortSignal.timeout(5 * 60_000),
      body: JSON.stringify({ text: j.prompt, duration_seconds: j.seconds, prompt_influence: 0.55, ...(j.kind === 'amb' ? { loop: true, model_id: 'eleven_text_to_sound_v2' } : {}) }),
    });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 240)}`);
  return Buffer.from(await res.arrayBuffer());
}

let idx = 0, ok = 0;
const fails: string[] = [];
await Promise.all(Array.from({ length: 2 }, async () => { // ElevenLabs plans cap concurrent requests (2 on this key)
  while (idx < todo.length) {
    const j = todo[idx++]!;
    const t = Date.now();
    try {
      const buf = await gen(j);
      fs.writeFileSync(path.join(OUT, j.file), buf);
      ok++;
      console.log(`ok ${j.file} ${(buf.length / 1024).toFixed(0)}KB ${((Date.now() - t) / 1000).toFixed(1)}s`);
    } catch (e) {
      fails.push(j.file);
      console.log(`FAIL ${j.file}: ${(e as Error).message}`);
      if (/quota|credits|401|insufficient/i.test((e as Error).message)) { idx = todo.length; }
    }
  }
}));
console.log(`done: ${ok} ok, ${fails.length} failed${fails.length ? ` (${fails.join(', ')})` : ''}`);
