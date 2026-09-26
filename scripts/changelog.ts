/**
 * 更新日志: validates src/data/changelog.json, requires an entry for the package.json version, writes CHANGELOG.md.
 *   npx tsx scripts/changelog.ts                     check + write CHANGELOG.md (part of every build)
 *   npx tsx scripts/changelog.ts --notes=1.0.1       print that version's notes as Markdown (GitHub Release body)
 */
import fs from 'node:fs';
import { z } from 'zod';

const PLATFORMS = { web: '网页', pc: 'PC', android: '安卓' } as const;
const zEntry = z.object({ text: z.string().min(1), platforms: z.array(z.enum(['web', 'pc', 'android'])).min(1).optional() }).strict();
const zVersion = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: z.string().min(1),
  sections: z.record(z.array(zEntry)),
}).strict();
const zLog = z.object({ $comment: z.string().optional(), versions: z.array(zVersion).min(1) }).strict();

const log = zLog.parse(JSON.parse(fs.readFileSync('src/data/changelog.json', 'utf8')));
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));

const num = (v: string) => v.split('.').map(Number).reduce((a, x) => a * 1000 + x, 0);
for (let i = 1; i < log.versions.length; i++) {
  if (num(log.versions[i - 1]!.version) <= num(log.versions[i]!.version)) throw new Error(`changelog: versions must be newest first (${log.versions[i - 1]!.version} before ${log.versions[i]!.version})`);
}

const md = (v: z.infer<typeof zVersion>, heading: string) => {
  const out = [`${heading} ${v.version} · ${v.title}（${v.date}）`, ''];
  for (const [section, entries] of Object.entries(v.sections)) {
    if (!entries.length) continue;
    out.push(`**${section}**`, '');
    for (const e of entries) out.push(`- ${e.platforms ? `【${e.platforms.map((p) => PLATFORMS[p]).join(' / ')}】` : ''}${e.text}`);
    out.push('');
  }
  return out.join('\n');
};

if (args.notes) {
  const want = String(args.notes).replace(/^v/, '');
  const v = log.versions.find((x) => x.version === want);
  if (!v) { console.error(`changelog: no entry for ${args.notes}`); process.exit(1); }
  process.stdout.write(md(v, '##'));
} else {
  if (!log.versions.some((v) => v.version === pkg.version)) throw new Error(`changelog: package.json is ${pkg.version} but src/data/changelog.json has no entry for it`);
  const doc = ['# 命阙 更新日志', '', '由 `src/data/changelog.json` 生成（`npm run changelog`），游戏内「设置 → 通用 → 更新日志」显示同一份内容。', '', ...log.versions.map((v) => md(v, '##'))].join('\n');
  fs.writeFileSync('CHANGELOG.md', doc);
  console.log(`changelog: ${log.versions.length} versions, current ${pkg.version} → CHANGELOG.md`);
}
