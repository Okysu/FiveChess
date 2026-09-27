/**
 * latest.json for the in-game update check: uploaded with every GitHub Release (release.yml) and fetched by the
 * clients from https://github.com/<repo>/releases/latest/download/latest.json (directly or through a gh proxy).
 *   npx tsx scripts/release-manifest.ts --out=dist-release/latest.json
 */
import fs from 'node:fs';
import path from 'node:path';

export const REPO = 'Okysu/FiveChess';
const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k!, v ?? 'true']; }));
const version = (JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string }).version;
const log = JSON.parse(fs.readFileSync('src/data/changelog.json', 'utf8')) as { versions: unknown[] };
const tag = `v${version}`;
const dl = (file: string) => `https://github.com/${REPO}/releases/download/${tag}/${file}`;

const manifest = {
  version,
  tag,
  date: new Date().toISOString().slice(0, 10),
  page: `https://github.com/${REPO}/releases/tag/${tag}`,
  assets: {
    pcSetup: dl(`mingque-setup-${version}.exe`),
    pcPortable: dl(`mingque-portable-${version}.exe`),
    android: dl(`mingque-${version}.apk`),
  },
  // the whole log: a client several versions behind shows everything it missed
  changelog: log.versions,
};
const out = String(args.out ?? 'latest.json');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));
console.log(`${out}: ${tag}`);
