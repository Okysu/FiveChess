/** Thin client for the OpenAI-compatible image API. Build-time only: reads the key from .env, never bundled. */
import fs from 'node:fs';
import 'dotenv/config';

const BASE = process.env.ASSET_GEN_BASE_URL ?? 'https://hjmai.yby.zone/v1';
const KEY = process.env.ASSET_GEN_API_KEY;
const MODEL = process.env.ASSET_GEN_MODEL ?? 'gpt-image-2';

export type Size = '1024x1024' | '1024x1536' | '1536x1024';
export interface GenOpts { prompt: string; size: Size; quality?: 'low' | 'medium' | 'high'; transparent?: boolean; ref?: string | string[] }

function need() {
  if (!KEY) throw new Error('ASSET_GEN_API_KEY missing — put it in .env (see .env.example)');
}

/** retries HTTP 429 (rate limit) honoring the server's "retry after N seconds" hint */
export async function generate(o: GenOpts): Promise<Buffer> {
  for (let attempt = 0; ; attempt++) {
    try { return await generateOnce(o); }
    catch (e) {
      const m = /HTTP 429.*?retry after (\d+) second/i.exec((e as Error).message);
      if (!m || attempt >= 8) throw e;
      await new Promise((r) => setTimeout(r, (Number(m[1]) + 2 + Math.random() * 4) * 1000));
    }
  }
}

async function generateOnce(o: GenOpts): Promise<Buffer> {
  need();
  const timeout = AbortSignal.timeout(240_000);
  let res: Response;
  if (o.ref) {
    const fd = new FormData();
    fd.append('model', MODEL);
    fd.append('prompt', o.prompt);
    fd.append('size', o.size);
    fd.append('quality', o.quality ?? 'medium');
    if (o.transparent) fd.append('background', 'transparent');
    const refs = Array.isArray(o.ref) ? o.ref : [o.ref];
    for (const r of refs) fd.append(refs.length > 1 ? 'image[]' : 'image', new Blob([fs.readFileSync(r)], { type: 'image/png' }), 'ref.png');
    res = await fetch(`${BASE}/images/edits`, { method: 'POST', headers: { Authorization: `Bearer ${KEY}` }, body: fd, signal: timeout });
  } else {
    const body: Record<string, unknown> = { model: MODEL, prompt: o.prompt, size: o.size, quality: o.quality ?? 'medium', n: 1 };
    if (o.transparent) body.background = 'transparent';
    res = await fetch(`${BASE}/images/generations`, {
      method: 'POST', headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: timeout,
    });
  }
  const txt = await res.text();
  let j: { data?: { b64_json?: string }[]; error?: { message?: string } };
  try { j = JSON.parse(txt); } catch { throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`); }
  const b64 = j.data?.[0]?.b64_json;
  if (!res.ok || !b64) throw new Error(`HTTP ${res.status}: ${j.error?.message ?? txt.slice(0, 200)}`);
  return Buffer.from(b64, 'base64');
}
