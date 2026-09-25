/** Art status: jobs per category, how many are already on disk, and output sizes. */
import fs from 'node:fs';
import { buildJobs } from './alljobs';

const by: Record<string, { n: number; done: number; px: Set<number> }> = {};
for (const j of buildJobs()) {
  const v = (by[j.category] ??= { n: 0, done: 0, px: new Set() });
  v.n++;
  v.px.add(j.px);
  if (fs.existsSync(`assets/${j.out}.webp`)) v.done++;
}
for (const [k, v] of Object.entries(by)) console.log(k.padEnd(12), String(v.n).padStart(4), 'done', String(v.done).padStart(4), 'px', [...v.px].join(','));
