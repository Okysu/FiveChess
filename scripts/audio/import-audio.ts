/**
 * Audio import: maps every game sound id / music mood / ambience to source files, copies the used ones
 * into assets/audio/, writes assets/audio/audio.json (read by src/game/audio/audio.ts) and records each file
 * in assets/manifest.json (source, author, license → CREDITS via `npm run credits`).
 *   npm run audio:import
 * Sources:
 *   art-src/audio/src/  CC0 packs (Kenney) and CC0 music (OpenGameArt / Tozan)
 *   art-src/audio/gen/  your own generated files named <id>.(mp3|ogg|wav) — sfx ids, "music_<mood>", "amb_<kind>".
 *                       A generated file always wins over the pack mapping. Prompts: docs/音频生成提示词.md
 * Anything left unmapped keeps the WebAudio synth fallback in game.
 */
import fs from 'node:fs';
import path from 'node:path';

const SRC = 'art-src/audio/src';
const GEN = 'art-src/audio/gen';
const OUT = 'assets/audio';

interface Pack { dir: string; author: string; url: string; license: string }
const PACKS: Record<string, Pack> = {
  casino: { dir: 'kenney_casino-audio/Audio', author: 'Kenney', url: 'https://kenney.nl/assets/casino-audio', license: 'CC0 1.0' },
  ui: { dir: 'kenney_interface-sounds/Audio', author: 'Kenney', url: 'https://kenney.nl/assets/interface-sounds', license: 'CC0 1.0' },
  impact: { dir: 'kenney_impact-sounds/Audio', author: 'Kenney', url: 'https://kenney.nl/assets/impact-sounds', license: 'CC0 1.0' },
  rpg: { dir: 'kenney_rpg-audio/Audio', author: 'Kenney', url: 'https://kenney.nl/assets/rpg-audio', license: 'CC0 1.0' },
  oga: { dir: '.', author: 'Tozan (OpenGameArt)', url: 'https://opengameart.org/users/tozan', license: 'CC0 1.0' },
};
const MUSIC_URL: Record<string, string> = {
  'Shangririver.ogg': 'https://opengameart.org/content/shangri-river',
  'orien_2.ogg': 'https://opengameart.org/content/orien',
  'orien1.ogg': 'https://opengameart.org/content/orient-peace-valley',
  'asianoriental2.ogg': 'https://opengameart.org/content/asianoriental2',
  'asianoriental1.ogg': 'https://opengameart.org/content/asianoriental1',
};

type Ref = [pack: keyof typeof PACKS, file: string];
const r = (pack: keyof typeof PACKS, ...files: string[]): Ref[] => files.map((f) => [pack, f.endsWith('.ogg') ? f : `${f}.ogg`]);

/** sound id → variants (+ gain). Ids missing here stay synthesized until a generated file exists. */
const SFX: Record<string, { v: Ref[]; gain?: number }> = {
  click: { v: r('ui', 'click_001', 'click_002'), gain: 0.5 },
  hover: { v: r('ui', 'tick_001', 'tick_002'), gain: 0.25 },
  cardHover: { v: r('casino', 'card-slide-1', 'card-slide-2', 'card-slide-3'), gain: 0.3 },
  deny: { v: r('ui', 'error_004', 'error_006'), gain: 0.45 },
  draw: { v: r('casino', 'card-slide-4', 'card-slide-5', 'card-slide-6'), gain: 0.55 },
  shuffle: { v: r('casino', 'card-shuffle'), gain: 0.6 },
  discard: { v: r('casino', 'card-shove-1', 'card-shove-2', 'card-shove-3'), gain: 0.5 },
  play: { v: r('casino', 'card-place-1', 'card-place-2', 'card-place-3', 'card-place-4'), gain: 0.7 },
  playUnit: { v: r('impact', 'impactWood_heavy_000', 'impactWood_heavy_001', 'impactWood_heavy_002'), gain: 0.55 },
  playResponse: { v: r('ui', 'glass_002', 'glass_003'), gain: 0.55 },
  playEquip: { v: r('rpg', 'drawKnife1', 'drawKnife2'), gain: 0.6 },
  playDelay: { v: r('rpg', 'bookPlace1', 'bookPlace2'), gain: 0.6 },
  playField: { v: r('impact', 'impactSoft_heavy_000', 'impactSoft_heavy_001'), gain: 0.6 },
  legendary: { v: r('impact', 'impactBell_heavy_000'), gain: 0.6 },
  hit: { v: r('impact', 'impactPunch_medium_000', 'impactPunch_medium_001', 'impactPunch_medium_002', 'impactPunch_medium_003'), gain: 0.6 },
  hitHeavy: { v: r('impact', 'impactPunch_heavy_000', 'impactPunch_heavy_001', 'impactPunch_heavy_002'), gain: 0.75 },
  block: { v: r('impact', 'impactMetal_medium_000', 'impactMetal_medium_001', 'impactMetal_medium_002'), gain: 0.5 },
  armor: { v: r('impact', 'impactPlate_light_000', 'impactPlate_light_001', 'impactPlate_light_002'), gain: 0.5 },
  wardBreak: { v: r('impact', 'impactGlass_heavy_000', 'impactGlass_heavy_001'), gain: 0.55 },
  death: { v: r('impact', 'impactSoft_heavy_002', 'impactSoft_heavy_003'), gain: 0.7 },
  window: { v: r('ui', 'question_001', 'question_002'), gain: 0.55 },
  declare: { v: r('ui', 'bong_001'), gain: 0.5 },
  judgeFlip: { v: r('casino', 'card-fan-1', 'card-fan-2'), gain: 0.6 },
  rejudge: { v: r('casino', 'card-slide-7', 'card-slide-8'), gain: 0.6 },
  freeze: { v: r('impact', 'impactGlass_light_000', 'impactGlass_light_001', 'impactGlass_light_002'), gain: 0.5 },
  stun: { v: r('impact', 'impactBell_heavy_002'), gain: 0.4 },
  buff: { v: r('ui', 'maximize_006', 'maximize_007'), gain: 0.45 },
  debuff: { v: r('ui', 'minimize_006', 'minimize_007'), gain: 0.45 },
  turnPlayer: { v: r('impact', 'impactBell_heavy_001'), gain: 0.35 },
  turnEnemy: { v: r('impact', 'impactBell_heavy_003'), gain: 0.35 },
  endTurn: { v: r('ui', 'switch_002', 'switch_003'), gain: 0.5 },
  ember: { v: r('ui', 'glass_004', 'glass_005'), gain: 0.45 },
  gold: { v: r('rpg', 'handleCoins', 'handleCoins2'), gain: 0.6 },
  relic: { v: r('ui', 'confirmation_004'), gain: 0.55 },
  step: { v: r('rpg', 'footstep00', 'footstep01', 'footstep02'), gain: 0.4 },
  // no fitting CC0 sample (stay synthesized until generated): sacrifice, burn, poison, heal, summon,
  // judgeSun/Thunder/Moon/Mountain, bossIntro, phase, victory, defeat
};

/** mood → track. Moods missing here keep the generative pentatonic music until generated. */
const MUSIC: Record<string, { file: string; gain?: number }> = {
  title: { file: 'asianoriental2.ogg', gain: 0.8 },
  map1: { file: 'Shangririver.ogg' },
  map2: { file: 'asianoriental1.ogg' },
  map3: { file: 'Shangririver.ogg' },
  map4: { file: 'asianoriental1.ogg' },
  battle: { file: 'orien_2.ogg' },
  elite: { file: 'orien_2.ogg' },
  camp: { file: 'orien1.ogg' },
  shop: { file: 'orien1.ogg' },
  // boss, final, victory, defeat: generated (see docs/音频生成提示词.md)
};

const AMB_KINDS = ['forest', 'water', 'stars', 'void', 'fire'];
const MOODS = ['title', 'map1', 'map2', 'map3', 'map4', 'battle', 'elite', 'boss', 'final', 'victory', 'defeat', 'camp', 'shop'];

// ───────────── build ─────────────
fs.rmSync(OUT, { recursive: true, force: true });
for (const d of ['sfx', 'music', 'amb']) fs.mkdirSync(path.join(OUT, d), { recursive: true });
const manifestPath = 'assets/manifest.json';
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { assets: Record<string, unknown>[] };
manifest.assets = manifest.assets.filter((a) => a.category !== 'audio');
const entries: Record<string, unknown>[] = [];
const genFiles = fs.existsSync(GEN) ? fs.readdirSync(GEN).filter((f) => /\.(mp3|ogg|wav|m4a)$/i.test(f)) : [];
const gen = (id: string) => genFiles.filter((f) => f.replace(/(_\d+)?\.[a-z0-9]+$/i, '') === id);

function copy(from: string, to: string, meta: { id: string; source: string; author: string; url: string; license: string; type: 'free_asset' | 'ai_generated' }) {
  fs.copyFileSync(from, path.join(OUT, to));
  entries.push({ id: meta.id, path: `audio/${to}`, category: 'audio', source_type: meta.type, source: meta.source, author: meta.author, url: meta.url, license: meta.license, postprocess: 'copied as-is', qa: 'ok' });
  return to;
}

const out: { sfx: Record<string, { files: string[]; gain: number }>; music: Record<string, { file: string; gain: number }>; amb: Record<string, { file: string; gain: number }> } = { sfx: {}, music: {}, amb: {} };
const GEN_META = { source: 'generated by the project owner (see docs/音频生成提示词.md)', author: '本项目', url: '', license: 'project-owned', type: 'ai_generated' as const };

const sfxIds = new Set([...Object.keys(SFX), 'sacrifice', 'burn', 'poison', 'heal', 'summon', 'judgeSun', 'judgeThunder', 'judgeMoon', 'judgeMountain', 'bossIntro', 'phase', 'victory', 'defeat']);
for (const id of sfxIds) {
  const g = gen(id);
  if (g.length) { out.sfx[id] = { files: g.map((f, i) => copy(path.join(GEN, f), `sfx/${id}_${i}${path.extname(f)}`, { id, ...GEN_META })), gain: 0.7 }; continue; }
  const m = SFX[id];
  if (!m) continue;
  const files = m.v.map(([pack, f], i) => {
    const p = PACKS[pack]!;
    const src = path.join(SRC, p.dir, f);
    if (!fs.existsSync(src)) throw new Error(`missing ${src}`);
    return copy(src, `sfx/${id}_${i}.ogg`, { id, source: `${p.url} (${f})`, author: p.author, url: p.url, license: p.license, type: 'free_asset' });
  });
  out.sfx[id] = { files, gain: m.gain ?? 0.6 };
}
for (const mood of MOODS) {
  const g = gen(`music_${mood}`);
  if (g.length) { out.music[mood] = { file: copy(path.join(GEN, g[0]!), `music/${mood}${path.extname(g[0]!)}`, { id: `music_${mood}`, ...GEN_META }), gain: 0.8 }; continue; }
  const m = MUSIC[mood];
  if (!m) continue;
  const dest = `music/${m.file}`;
  if (!fs.existsSync(path.join(OUT, dest))) copy(path.join(SRC, m.file), dest, { id: `music_${m.file}`, source: MUSIC_URL[m.file] ?? PACKS.oga!.url, author: PACKS.oga!.author, url: MUSIC_URL[m.file] ?? PACKS.oga!.url, license: PACKS.oga!.license, type: 'free_asset' });
  out.music[mood] = { file: dest, gain: m.gain ?? 0.7 };
}
for (const kind of AMB_KINDS) {
  const g = gen(`amb_${kind}`);
  if (g.length) out.amb[kind] = { file: copy(path.join(GEN, g[0]!), `amb/${kind}${path.extname(g[0]!)}`, { id: `amb_${kind}`, ...GEN_META }), gain: 0.5 };
}

fs.writeFileSync(path.join(OUT, 'audio.json'), JSON.stringify(out, null, 1));
manifest.assets.push(...entries);
manifest.assets.sort((a, b) => String(a.path).localeCompare(String(b.path)));
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
const missSfx = [...sfxIds].filter((id) => !out.sfx[id]);
const missMusic = MOODS.filter((m) => !out.music[m]);
const missAmb = AMB_KINDS.filter((k) => !out.amb[k]);
console.log(`audio: ${Object.keys(out.sfx).length} sfx, ${Object.keys(out.music).length} music moods, ${Object.keys(out.amb).length} ambience · ${entries.length} files`);
console.log(`still synthesized → sfx: ${missSfx.join(', ') || '—'} · music: ${missMusic.join(', ') || '—'} · ambience: ${missAmb.join(', ') || '—'}`);
