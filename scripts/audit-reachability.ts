/**
 * Reachability audit: finds content & features that players can never reach, by tracing how the engine
 * actually selects things (run.ts / map.ts / meta.ts / combat effects) against the data.
 *
 *   npx tsx scripts/audit-reachability.ts          → report (exit 0)
 *   npx tsx scripts/audit-reachability.ts --ci     → exit 1 if any ERROR finding
 *
 * Mostly static analysis over content + engine source, plus cheap engine sampling
 * (generateMap / newRun / the real unlock code in meta.ts) where behaviour is easier to observe than to parse.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadContent, listJson, DATA_DIR } from './load-content';
import { matchCard } from '../src/engine/content';
import { generateMap, type NodeType } from '../src/engine/run/map';
import { newRun, runAct, type RunState } from '../src/engine/run/run';
import { newProfile, recordRun, lockedContent, UNLOCK_TRACK, type Profile, type RunSummary } from '../src/engine/meta';
import type { CardDef, CardFilter, Color, RelicTier, RunCondition } from '../src/engine/defs';

const ROOT = path.resolve(DATA_DIR, '../..');
const c = loadContent();

// ───────────── evidence helpers ─────────────
const rel = (f: string) => path.relative(ROOT, f).replace(/\\/g, '/');
const srcCache = new Map<string, string[]>();
const lines = (f: string) => { const p = path.resolve(ROOT, f); if (!srcCache.has(p)) srcCache.set(p, fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split(/\r?\n/) : []); return srcCache.get(p)!; };
const text = (f: string) => lines(f).join('\n');
/** first line in `file` matching `re` (after line `from`) → "file:line" */
function at(file: string, re: RegExp | string, from = 0): string {
  const ls = lines(file);
  for (let i = from; i < ls.length; i++) if (typeof re === 'string' ? ls[i]!.includes(re) : re.test(ls[i]!)) return `${file}:${i + 1}`;
  return `${file}:?`;
}
/** definition site of every top-level content id (the file whose array contains it) */
const idLoc = new Map<string, string>();
for (const f of listJson()) {
  const data = JSON.parse(fs.readFileSync(f, 'utf8')) as unknown;
  if (!Array.isArray(data)) continue;
  for (const it of data) { const id = (it as { id?: string }).id; if (id && !idLoc.has(id)) idLoc.set(id, at(rel(f), `"id": "${id}"`)); }
}
const loc = (id: string) => idLoc.get(id) ?? '?';
/** all src files under a dir */
function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(path.resolve(ROOT, dir), { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p)); else if (/\.ts$/.test(e.name)) out.push(p.replace(/\\/g, '/'));
  }
  return out;
}

type Sev = 'ERROR' | 'WARN' | 'INFO';
const findings: Record<string, { sev: Sev; msg: string }[]> = {};
const report = (cat: string, sev: Sev, msg: string) => (findings[cat] ??= []).push({ sev, msg });

const RUN = 'src/engine/run/run.ts', MAP = 'src/engine/run/map.ts', META = 'src/engine/meta.ts', DEFS = 'src/engine/defs.ts';

// ───────────── engine sampling ─────────────
// map node types per act (all flag combinations the engine passes)
const nodeTypesByAct = new Map<number, Set<NodeType>>();
for (const act of [1, 2, 3, 4]) for (const hasLieutenant of [false, true]) for (const tutorial of [false, true]) for (const ascension of [0, 1]) {
  for (let i = 0; i < 150; i++) {
    const m = generateMap(`audit${i}/map:${act}`, { act, hasLieutenant, tutorial, ascension });
    const set = nodeTypesByAct.get(act) ?? new Set<NodeType>();
    for (const row of m.rows) for (const n of row) set.add(n.type);
    nodeTypesByAct.set(act, set);
  }
}
const actsWith = (t: NodeType) => [...nodeTypesByAct].filter(([, s]) => s.has(t)).map(([a]) => a);
const combatActs = actsWith('combat'), eliteActs = actsWith('elite'), eventActs = actsWith('event'), recruitActs = actsWith('recruit');

// ───────────── unlocks (real meta.ts code) ─────────────
const fakeRun = (cmd: string) => ({ commander: cmd, ascension: 0, discovered: { cards: [], enemies: [], relics: [] } }) as never;
const fakeSummary = (score: number): RunSummary => ({ seed: 'audit', commander: 'r_huojin', lieutenant: null, ascension: 0, result: 'lose', act: 1, floor: 1, score, date: 0, deck: [], relics: [], turns: 0, maxDamage: 0 });
const full: Profile = newProfile();
recordRun(full, fakeRun('r_huojin'), fakeSummary(1e7));
const permLocked = lockedContent(full);
const reachCmd = new Set(full.unlocked.commanders);

// ───────────── reachability fixpoint ─────────────
const COLORS_ALL: Color[] = ['R', 'B', 'G', 'Y', 'P', 'K', 'W', 'N'];
const reach = {
  cards: new Map<string, string>(), relics: new Map<string, string>(), potions: new Map<string, string>(),
  enemies: new Map<string, string>(), encounters: new Map<string, string>(), events: new Map<string, string>(),
  lts: new Map<string, string>(), flags: new Map<string, number>(), relicTiers: new Map<string, string>(),
};
const dangling: string[] = [];
const add = (m: Map<string, string>, id: string, why: string) => { if (!m.has(id)) { m.set(id, why); changed = true; } };
let changed = true;

// lieutenants: recruit offers exclude the commander's own faction; locked list after all unlocks
for (const l of c.lieutenants.values()) {
  const cmdOk = [...reachCmd].some((id) => c.commanders.get(id)?.faction !== l.faction);
  if (cmdOk && recruitActs.length && !permLocked.lieutenants.includes(l.id)) add(reach.lts, l.id, 'recruit');
}
const colors = (): Color[] => [...new Set<Color>(['N', ...[...reachCmd].map((id) => c.commanders.get(id)!.faction), ...[...reach.lts.keys()].map((id) => c.lieutenants.get(id)!.faction)])];

// reward-pool rarities: literals returned by rarityFor()
const rarBody = text(RUN).match(/function rarityFor[\s\S]*?\n}/)?.[0] ?? '';
const rewardRarities = new Set([...rarBody.matchAll(/return ([^;]*);/g)].flatMap((m) => [...m[1]!.matchAll(/'(\w+)'/g)].map((x) => x[1]!)));
// relic tiers rolled in code: rollRelic(…, 'tier') + literals inside rollRelicTier + shop tier list
const tierLits = (s: string) => [...s.matchAll(/'(starter|common|uncommon|rare|boss|shop|event)'/g)].map((m) => m[1]!);
const rrtBody = text(RUN).match(/function rollRelicTier[\s\S]*?\n}/)?.[0] ?? '';
for (const t of tierLits(rrtBody)) add(reach.relicTiers, t, at(RUN, 'function rollRelicTier'));
text(RUN).split('\n').forEach((l, i) => { if (/rollRelic\(r, rng, '(\w+)'\)/.test(l)) add(reach.relicTiers, RegExp.$1, `${RUN}:${i + 1}`); if (/const tiers: RelicTier\[\]/.test(l)) for (const t of tierLits(l)) add(reach.relicTiers, t, `${RUN}:${i + 1}`); });
// potion rarities weighted in rollPotion
const potW = text(RUN).match(/function rollPotion[\s\S]*?const w = \{([^}]*)\}/)?.[1] ?? '';
const potionRarities = new Set([...potW.matchAll(/(\w+):\s*(\d+)/g)].filter((m) => +m[2]! > 0).map((m) => m[1]!));

// engine-code literals referencing content ids (e.g. A10 curse)
const codeRefs = new Map<string, string>();
for (const f of tsFiles('src/engine')) lines(f).forEach((l, i) => { for (const m of l.matchAll(/'([a-z][a-z0-9_]+)'/g)) if (c.cards.has(m[1]!) || c.relics.has(m[1]!) || c.enemies.has(m[1]!)) codeRefs.set(m[1]!, `${f}:${i + 1}`); });
for (const [id, where] of codeRefs) if (c.cards.has(id)) add(reach.cards, id, `code ${where}`);

// starters + reward pool
for (const id of reachCmd) for (const cid of c.commanders.get(id)!.deck) add(reach.cards, cid, `starter deck ${id}`);
const poolCards = (f: CardFilter = {}) => c.filterCards(f, colors()).filter((x) => !permLocked.cards.includes(x.id));

// effect walker
const effectsIn = (o: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] => {
  if (Array.isArray(o)) o.forEach((x) => effectsIn(x, out));
  else if (o && typeof o === 'object') { if (typeof (o as { op?: unknown }).op === 'string') out.push(o as Record<string, unknown>); for (const [k, v] of Object.entries(o)) if (k !== 'art') effectsIn(v, out); }
  return out;
};
const unitRef = (id: string, why: string) => {
  if (c.enemies.has(id)) add(reach.enemies, id, why); else if (c.cards.has(id)) add(reach.cards, id, why); else dangling.push(`${id} (${why})`);
};
const cardRef = (id: string, why: string) => { if (c.cards.has(id)) add(reach.cards, id, why); else dangling.push(`card ${id} (${why})`); };
function applyEffects(o: unknown, why: string, act = 1) {
  for (const e of effectsIn(o)) {
    const card = e.card, pool = e.pool as CardFilter | undefined;
    switch (e.op) {
      case 'create': if (typeof card === 'string') cardRef(card, why); else if (card && typeof card === 'object') for (const d of c.filterCards((card as { pool: CardFilter }).pool, colors())) add(reach.cards, d.id, why); break;
      case 'discover': for (const d of c.filterCards(pool!, colors())) add(reach.cards, d.id, why); break;
      case 'summon': unitRef(e.unit as string, why); break;
      case 'transform': unitRef(e.into as string, why); break;
      case 'delay': case 'equip': case 'field': cardRef(card as string, why); break;
      case 'addCard':
        if (typeof card === 'string') cardRef(card, why);
        else if (pool && (pool.type === 'curse' || pool.type === 'status')) { for (const d of c.cards.values()) if (matchCard(d, pool, colors())) add(reach.cards, d.id, why); }
        else for (const d of poolCards(pool ?? {})) add(reach.cards, d.id, why);
        break;
      case 'addRelic': if (e.relic) { if (c.relics.has(e.relic as string)) add(reach.relics, e.relic as string, why); else dangling.push(`relic ${e.relic} (${why})`); } else if (e.tier) add(reach.relicTiers, e.tier as string, why); break;
      case 'addPotion': if (e.potion) { if (c.potions.has(e.potion as string)) add(reach.potions, e.potion as string, why); else dangling.push(`potion ${e.potion} (${why})`); } break;
      case 'fight': { const enc = e.encounter as string; if (!/^random:/.test(enc)) { if (c.encounters.has(enc)) add(reach.encounters, enc, why); else dangling.push(`encounter ${enc} (${why})`); } break; }
      case 'lieutenant': if (e.id) { if (c.lieutenants.has(e.id as string)) add(reach.lts, e.id as string, why); else dangling.push(`lieutenant ${e.id} (${why})`); } break;
      case 'flag': { const k = e.key as string; const prev = reach.flags.get(k); if (prev === undefined || act < prev) { reach.flags.set(k, act); changed = true; } break; }
    }
  }
}
// code-set flags
for (const f of tsFiles('src/engine')) lines(f).forEach((l) => { for (const m of l.matchAll(/flags\.push\((['`])([^'`$]+)/g)) reach.flags.set(m[2]!, 1); });

const earliestLt = () => Math.min(...recruitActs, ...[...reach.lts.values()].filter((w) => w.startsWith('event')).map((w) => +(w.match(/act(\d)/)?.[1] ?? 9)));
/** can condition be true at some act in `acts`? returns reason if not */
function unsat(cond: RunCondition, acts: number[]): string | null {
  const maxAct = Math.max(...acts);
  if ('flag' in cond) { const a = reach.flags.get(cond.flag); return a === undefined ? `flag '${cond.flag}' is never set` : a > maxAct ? `flag '${cond.flag}' only set from act ${a}` : null; }
  if ('commander' in cond) return reachCmd.has(cond.commander) ? null : `commander ${cond.commander} unobtainable/missing`;
  if ('lieutenant' in cond) return !reach.lts.has(cond.lieutenant) ? `lieutenant ${cond.lieutenant} unobtainable` : earliestLt() > maxAct ? `lieutenants only from act ${earliestLt()}` : null;
  if ('hasRelic' in cond) return reach.relics.has(cond.hasRelic) ? null : `relic ${cond.hasRelic} unobtainable`;
  if ('faction' in cond) return colors().includes(cond.faction) ? null : `faction ${cond.faction} never own`;
  if ('act' in cond) return acts.includes(cond.act) ? null : `requires act ${cond.act} but shown in acts ${acts}`;
  if ('deckHas' in cond) return [...reach.cards.keys()].some((id) => matchCard(c.cards.get(id)!, cond.deckHas, colors())) ? null : 'no reachable card matches deckHas';
  if ('hpAbove' in cond) { const mx = Math.max(...[...reachCmd].map((id) => c.commanders.get(id)!.hp)); return cond.hpAbove >= mx ? `hpAbove ${cond.hpAbove} ≥ max commander hp ${mx}` : null; }
  return null;
}

const eventOptState = new Map<string, { deadOpts: string[]; missingPages: string[]; unreachedPages: string[] }>();
for (let iter = 0; changed && iter < 50; iter++) {
  changed = false;
  for (const d of poolCards()) if (rewardRarities.has(d.rarity)) add(reach.cards, d.id, 'reward/shop pool');
  for (const r of c.relics.values()) {
    const why = reach.relicTiers.get(r.tier);
    if (r.tier === 'starter') {
      const cm = [...reachCmd].find((id) => c.commanders.get(id)!.relic === r.id);
      if (cm) add(reach.relics, r.id, `starter of ${cm}`);
      // 精通 3: the second starter relic (src/engine/meta.ts effectiveLoadout)
      const alt = [...reachCmd].find((id) => c.commanders.get(id)!.alt?.relic === r.id);
      if (alt) add(reach.relics, r.id, `精通 3 starter of ${alt}`);
      continue;
    }
    if (why && (!r.faction || r.faction === 'N' || colors().includes(r.faction)) && !permLocked.relics.includes(r.id)) add(reach.relics, r.id, `tier ${r.tier} rolled (${why})`);
  }
  for (const p of c.potions.values()) if (potionRarities.has(p.rarity)) add(reach.potions, p.id, 'rollPotion');
  // encounters as the engine picks them
  for (const e of c.encounters.values()) {
    const w = (e.weight ?? 1) > 0;
    if (e.tier === 'normal' && w && combatActs.includes(e.act) && e.act !== 4) add(reach.encounters, e.id, `pickEncounter normal act ${e.act}`);
    if (e.tier === 'elite' && w && eliteActs.includes(e.act) && e.act !== 4) add(reach.encounters, e.id, `pickEncounter elite act ${e.act}`);
  }
  for (const id of reachCmd) applyEffects(c.commanders.get(id)!.skills, `commander ${id}`);
  for (const id of reach.lts.keys()) applyEffects(c.lieutenants.get(id)!.skill, `lieutenant ${id}`);
  for (const id of [...reach.cards.keys()]) applyEffects(c.cards.get(id), `card ${id}`);
  for (const id of [...reach.relics.keys()]) applyEffects(c.relics.get(id), `relic ${id}`);
  for (const id of [...reach.potions.keys()]) applyEffects(c.potions.get(id), `potion ${id}`);
  for (const id of [...reach.encounters.keys()]) for (const x of c.encounters.get(id)!.enemies) add(reach.enemies, x.id, `encounter ${id}`);
  for (const id of [...reach.enemies.keys()]) {
    const en = c.enemies.get(id)!;
    applyEffects(en, `enemy ${id}`);
    for (const cid of en.deck ?? []) cardRef(cid, `enemy deck ${id}`);
    for (const v of en.variants ?? []) add(reach.enemies, v, `variant of ${id}`);
  }
  // events
  for (const ev of c.events.values()) {
    const acts = ev.acts.filter((a) => eventActs.includes(a));
    if (!acts.length || permLocked.events.includes(ev.id)) continue;
    if (ev.requires && unsat(ev.requires, acts)) continue;
    add(reach.events, ev.id, `event node acts ${acts}`);
    const st = { deadOpts: [] as string[], missingPages: [] as string[], unreachedPages: [] as string[] };
    const seenPages = new Set<string>();
    const walk = (opts: typeof ev.options, where: string) => opts.forEach((o, i) => {
      const bad = o.requires && unsat(o.requires, acts);
      if (bad) { st.deadOpts.push(`${where}#${i} "${o.text.slice(0, 14)}": ${bad}`); return; }
      applyEffects(o.effects, `event ${ev.id} act${Math.min(...acts)}`, Math.min(...acts));
      if (o.next) {
        const pg = ev.pages?.find((p) => p.id === o.next);
        if (!pg) st.missingPages.push(o.next);
        else if (!seenPages.has(pg.id)) { seenPages.add(pg.id); walk(pg.options, `page ${pg.id}`); }
      }
    });
    walk(ev.options, 'root');
    st.unreachedPages = (ev.pages ?? []).map((p) => p.id).filter((p) => !seenPages.has(p));
    eventOptState.set(ev.id, st);
  }
  // bosses (sampled via newRun below, added once)
}

// bosses: sample the real newRun selection
const bossSeen = new Map<number, Set<string>>();
let hiddenEnc: string | null = null;
for (let i = 0; i < 300; i++) {
  const r = newRun({ seed: `audit${i}`, commander: 'r_huojin', ascension: 0 });
  for (const [a, id] of Object.entries(r.bosses)) { const s = bossSeen.get(+a) ?? new Set(); s.add(id); bossSeen.set(+a, s); }
  if (i < 20) { r.screen = { k: 'hiddenChoice' }; runAct(r, { t: 'hidden', go: true }); const sc = r.screen as RunState['screen']; if (sc.k === 'combat') hiddenEnc = sc.encounter; }
}
changed = true;
for (const [, ids] of bossSeen) for (const id of ids) add(reach.encounters, id, 'newRun boss pick');
if (hiddenEnc) add(reach.encounters, hiddenEnc, 'hidden boss (hiddenChoice)');
// re-run enemy/effect closure for the bosses
for (let iter = 0; changed && iter < 20; iter++) {
  changed = false;
  for (const id of [...reach.encounters.keys()]) for (const x of c.encounters.get(id)!.enemies) add(reach.enemies, x.id, `encounter ${id}`);
  for (const id of [...reach.enemies.keys()]) { const en = c.enemies.get(id)!; applyEffects(en, `enemy ${id}`); for (const cid of en.deck ?? []) cardRef(cid, `enemy deck ${id}`); for (const v of en.variants ?? []) add(reach.enemies, v, `variant of ${id}`); }
  for (const id of [...reach.cards.keys()]) applyEffects(c.cards.get(id), `card ${id}`);
}

// ═════════════ 1. cards ═════════════
const flagsRead = new Set<string>();
for (const f of listJson()) for (const m of fs.readFileSync(f, 'utf8').matchAll(/"flag":\s*"([^"]+)"/g)) flagsRead.add(m[1]!);
for (const d of c.cards.values()) {
  if (reach.cards.has(d.id)) continue;
  const why = d.pool === false || ['basic', 'token', 'special'].includes(d.rarity) || d.type === 'status' || d.type === 'curse'
    ? `excluded from pool (${d.rarity}/${d.type}${d.pool === false ? '/pool:false' : ''}) and not in any starter deck, enemy deck, code or effect`
    : `faction ${d.faction} never own / rarity ${d.rarity} never rolled`;
  report('1 cards', 'ERROR', `${d.id} — ${why} (${loc(d.id)})`);
}
const lockNote = permLocked.cards.length ? `${permLocked.cards.length} cards stay locked after full unlock track` : 'card packs: UNLOCK_TRACK grants enough packs to unlock all locked epic/legendary cards';
report('1 cards', permLocked.cards.length ? 'ERROR' : 'INFO', lockNote);
report('1 cards', 'INFO', `reward rarities from rarityFor(): ${[...rewardRarities].join(',')} (${at(RUN, 'function rarityFor')}); pool colors = commander ∪ lieutenant ∪ N = ${colors().join('')}`);

// ═════════════ 2. relics ═════════════
for (const r of c.relics.values()) if (!reach.relics.has(r.id)) {
  const why = r.tier === 'starter' ? 'starter relic not referenced by any unlockable commander'
    : r.tier === 'event' && !reach.relicTiers.has('event') ? 'event-tier relic not granted by id and no addRelic{tier:"event"}'
      : permLocked.relics.includes(r.id) ? 'in a relic pack the unlock track never opens'
        : !reach.relicTiers.has(r.tier) ? `tier '${r.tier}' never rolled` : `faction ${r.faction} never own`;
  report('2 relics', 'ERROR', `${r.id} (${r.tier}) — ${why} (${loc(r.id)})`);
}
for (const t of ['common', 'uncommon', 'rare', 'boss', 'shop', 'event'] as RelicTier[]) report('2 relics', reach.relicTiers.has(t) ? 'INFO' : 'ERROR', `tier ${t}: ${reach.relicTiers.has(t) ? `rolled at ${reach.relicTiers.get(t)}` : 'NEVER rolled'}`);
// run rules nobody reads
const runRules = [...text(DEFS).matchAll(/\{ rule: '(\w+)'/g)].map((m) => m[1]!);
const engineAndGame = [...tsFiles('src/engine'), ...tsFiles('src/game')].filter((f) => !/defs\.ts$|schema\.ts$/.test(f));
for (const rule of runRules) {
  if (engineAndGame.some((f) => text(f).includes(`'${rule}'`))) continue;
  const users = [...c.relics.values()].filter((r) => r.run?.some((x) => x.rule === rule)).map((r) => `${r.id} (${loc(r.id)})`);
  report('2 relics', users.length ? 'ERROR' : 'WARN', `run rule '${rule}' is never read by engine/UI (${at(DEFS, `rule: '${rule}'`)}) → no effect on: ${users.join(', ') || 'no relic'}`);
}

// ═════════════ 3. potions ═════════════
for (const p of c.potions.values()) if (!reach.potions.has(p.id)) report('3 potions', 'ERROR', `${p.id} — rarity ${p.rarity} has no weight in rollPotion and never granted by id (${loc(p.id)})`);
report('3 potions', 'INFO', `rollPotion weights rarities: ${[...potionRarities].join(',')} (${at(RUN, 'const w = { common')})`);

// ═════════════ 4. enemies ═════════════
for (const e of c.enemies.values()) if (!reach.enemies.has(e.id)) report('4 enemies', e.id.startsWith('sandbox') ? 'INFO' : 'ERROR', `${e.id} (act ${e.act} ${e.tier}) — in no reachable encounter and never summoned/transformed (${loc(e.id)})`);

// ═════════════ 5. encounters ═════════════
for (const e of c.encounters.values()) if (!reach.encounters.has(e.id)) {
  const why = (e.weight ?? 1) <= 0 ? 'weight 0 (debug)' : e.tier === 'boss' ? 'boss never chosen by newRun (and not the hidden boss)' : `act ${e.act} has no ${e.tier === 'elite' ? 'elite' : 'combat'} nodes and no event fights it`;
  report('5 encounters', (e.weight ?? 1) <= 0 ? 'INFO' : 'ERROR', `${e.id} — ${why} (${loc(e.id)})`);
}
for (const [a, ids] of [...bossSeen].sort()) report('5 encounters', 'INFO', `act ${a} bosses chosen (300 seeds): ${[...ids].join(', ')} (${at(RUN, 'const bossEncs')})`);
report('5 encounters', 'INFO', `hidden boss via hiddenChoice → ${hiddenEnc ?? 'NONE'} (${at(RUN, "const hidden = [...content().encounters")}); node acts: combat ${combatActs} elite ${eliteActs} event ${eventActs}`);
if (c.encounters.size) {
  const a4 = [...c.encounters.values()].filter((e) => e.act === 4 && e.tier === 'boss').map((e) => e.id);
  if (a4.length > 2) report('5 encounters', 'WARN', `hidden boss = first act-4 boss ≠ bosses[4] in load order — with ${a4.length} act-4 bosses it may pick a normal boss, not the nameless one`);
}

// ═════════════ 6. events ═════════════
for (const ev of c.events.values()) {
  if (!reach.events.has(ev.id)) {
    const acts = ev.acts.filter((a) => eventActs.includes(a));
    report('6 events', 'ERROR', `${ev.id} — ${!acts.length ? `acts [${ev.acts}] have no event nodes` : permLocked.events.includes(ev.id) ? 'locked forever' : unsat(ev.requires!, acts)} (${loc(ev.id)})`);
    continue;
  }
  const st = eventOptState.get(ev.id)!;
  const f = loc(ev.id).split(':')[0]!;
  const evLine = +(loc(ev.id).split(':')[1] ?? 0);
  for (const d of st.deadOpts) report('6 events', 'ERROR', `${ev.id} option ${d} (${loc(ev.id)})`);
  for (const p of st.missingPages) report('6 events', 'ERROR', `${ev.id} option → missing page '${p}' (${at(f, `"next": "${p}"`, evLine)})`);
  for (const p of st.unreachedPages) report('6 events', 'ERROR', `${ev.id} page '${p}' never reached by any 'next' (${at(f, `"id": "${p}"`, evLine)})`);
}
for (const f of listJson()) lines(f).forEach((l, i) => { if (/"op":\s*"loseRelic",\s*"mode":\s*"choose"/.test(l)) report('6 events', 'WARN', `loseRelic mode "choose" is implemented as random (${at(RUN, "case 'loseRelic'")}); PickKind 'loseRelic' never pushed (${rel(f)}:${i + 1})`); if (/"op":\s*"removeCard"[^}]*"filter"/.test(l) && !/pickCandidates\(r, kind, filter\)/.test(text(RUN))) report('6 events', 'WARN', `removeCard.filter ignored by applyRunEffect (${rel(f)}:${i + 1})`); });
const epilogueFlags = fs.existsSync(path.join(DATA_DIR, 'lore', 'epilogues.json')) ? fs.readFileSync(path.join(DATA_DIR, 'lore', 'epilogues.json'), 'utf8') : '';
// 主帅命途 endings are read as `path_${cmd.id}_a` (runEnd.ts)
const pathFlagRead = (flag: string) => /^path_.+_[ab]$/.test(flag) && engineAndGame.some((f) => text(f).includes('`path_${'));
for (const [flag, a] of reach.flags) if (!flagsRead.has(flag) && !pathFlagRead(flag) && !epilogueFlags.includes('"' + flag + '"') && !engineAndGame.some((f) => text(f).includes(`'${flag}'`) || text(f).includes('`' + flag.split(':')[0]))) report('6 events', 'WARN', `flag '${flag}' set (act ${a}) but never read by any requires/code (${at(listJson().map(rel).find((f) => text(f).includes(`"key": "${flag}"`)) ?? RUN, flag)})`);
// flags the engine sets itself (e.g. 真结局 'true_end_close' in run.ts) count as set
for (const flag of flagsRead) if (!reach.flags.has(flag) && !engineAndGame.some((f) => text(f).includes(`'${flag}'`))) report('6 events', 'ERROR', `flag '${flag}' required but never set`);
for (const d of dangling) report('6 events', 'ERROR', `dangling reference ${d}`);

// ═════════════ 7. commanders / lieutenants ═════════════
for (const cm of c.commanders.values()) if (!reachCmd.has(cm.id)) report('7 commanders/lieutenants', 'ERROR', `${cm.id} — not default-unlocked and not in UNLOCK_TRACK (${loc(cm.id)}; ${at(META, 'UNLOCK_TRACK')})`);
for (const cid of UNLOCK_TRACK.flatMap((s) => s.commanders ?? [])) if (!c.commanders.has(cid)) report('7 commanders/lieutenants', 'ERROR', `UNLOCK_TRACK references missing commander ${cid}`);
for (const l of c.lieutenants.values()) if (!reach.lts.has(l.id)) report('7 commanders/lieutenants', 'ERROR', `${l.id} — never offered (faction/locks/no recruit nodes) (${loc(l.id)})`);
report('7 commanders/lieutenants', 'INFO', `recruit nodes appear in acts ${recruitActs} (${at(MAP, "['recruit'")}; guaranteed ×3 in act 2 ${at(MAP, 'guarantee recruit')})`);
{ // lieutenant unlock is a one-time snapshot of content ids
  const p: Profile = JSON.parse(JSON.stringify(full));
  const victim = p.unlocked.lieutenants.pop()!;
  recordRun(p, fakeRun('r_huojin'), fakeSummary(1e7));
  if (lockedContent(p).lieutenants.includes(victim)) report('7 commanders/lieutenants', 'WARN', `lieutenant unlock snapshots content ids once: any lieutenant added after a profile passed the xp-1 step stays locked forever (simulated with ${victim}) (${at(META, 'p.unlocked.lieutenants = [')}; ${at(META, 'lieutenants: p.unlocked.lieutenants.length')})`);
}
{
  const packs = { card: UNLOCK_TRACK.filter((s) => s.cardPack).length, relic: UNLOCK_TRACK.filter((s) => s.relicPack).length, event: UNLOCK_TRACK.filter((s) => s.eventPack).length };
  report('7 commanders/lieutenants', 'INFO', `unlock track grants packs card×${packs.card} relic×${packs.relic} event×${packs.event}; after full track locked = ${JSON.stringify({ cards: permLocked.cards.length, relics: permLocked.relics.length, events: permLocked.events.length, lts: permLocked.lieutenants.length })}`);
}

// ═════════════ 8. map / screens / hidden ending ═════════════
const nodeTypes = (text(MAP).match(/export type NodeType =([^;]+);/)?.[1] ?? '').match(/'(\w+)'/g)!.map((s) => s.slice(1, -1));
for (const t of nodeTypes) {
  const acts = actsWith(t as NodeType);
  report('8 map/screens', acts.length ? 'INFO' : 'ERROR', `node '${t}': ${acts.length ? `generated in acts ${acts}` : 'NEVER generated'}${t === 'boss' ? ` (acts 1–3 via bossNode() ${at(RUN, 'export function bossNode')})` : ''}`);
}
const screenUnion = text(RUN).match(/export type Screen =([\s\S]*?);\n\n/)?.[1] ?? '';
const screens = [...screenUnion.matchAll(/k: '(\w+)'/g)].map((m) => m[1]!);
const router = text('src/game/router.ts');
for (const k of screens) {
  const uses = [...text(RUN).matchAll(new RegExp(`k: '${k}'`, 'g'))].length - 1;
  if (uses <= 0) report('8 map/screens', 'ERROR', `screen '${k}' is never pushed (${at(RUN, `k: '${k}'`)})`);
  if (!router.includes(`'${k}'`)) report('8 map/screens', 'WARN', `screen '${k}' has no router case (falls back to MapScene) (src/game/router.ts)`);
}
const pickKinds = (text(RUN).match(/export type PickKind =([^;]+);/)?.[1] ?? '').match(/'(\w+)'/g)!.map((s) => s.slice(1, -1));
for (const k of pickKinds) if (!new RegExp(`kind[^\\n]*'${k}'|'${k}' :|\\? '${k}'`).test(text(RUN).replace(/export type PickKind[^;]+;/, ''))) report('8 map/screens', 'WARN', `PickKind '${k}' is never used for a pick screen (${at(RUN, 'export type PickKind')})`);
{
  const setHidden = at(META, 'p.hiddenUnlocked = true'), passHidden = at('src/game/state.ts', 'unlockedHidden: this.profile.hiddenUnlocked'), gate = at(RUN, "k: 'hiddenChoice' }; return;");
  report('8 map/screens', hiddenEnc ? 'INFO' : 'ERROR', `hidden ending: any win sets profile.hiddenUnlocked (${setHidden}) → next run passes unlockedHidden (${passHidden}) → after act-4 boss relic, advanceAct shows hiddenChoice (${gate}) → '${hiddenEnc}' with reward 'none' → proceed → victory (${at(RUN, "r.flags.includes('hidden_boss')) { r.result")})`);
  if (!text(RUN).includes('hidden_boss_lost')) report('8 map/screens', 'WARN', `losing the optional hidden boss records the whole (already won) run as 'lose' (${at(RUN, "r.result = 'lose';")}); hidden-boss win does not count stats.bosses (${at(RUN, "if (sc.reward === 'boss')")})`);
  const exp = text(RUN).match(/export function (\w+)/g)!.map((s) => s.split(' ')[2]!);
  const allSrc = [...tsFiles('src'), ...tsFiles('scripts')].filter((f) => f !== RUN && !f.includes('audit-reachability')).map(text).join('\n');
  for (const fn of exp) if (!new RegExp(`\\b${fn}\\b`).test(allSrc) && !new RegExp(`\\b${fn}\\(`).test(text(RUN).replace(`export function ${fn}`, ''))) report('8 map/screens', 'WARN', `run.ts export ${fn}() is never called (${at(RUN, `export function ${fn}`)})`);
}

// ═════════════ 9. ascension ═════════════
const doc = lines('docs/游戏设计文档.md');
const docAsc = new Map<number, string>();
const hdr = doc.findIndex((l) => /逆命.*1–15/.test(l));
for (let i = hdr + 1; i < doc.length && i < hdr + 25; i++) { const m = doc[i]!.match(/^\|\s*(\d+)\s*\|\s*(.+?)\s*\|/); if (m) docAsc.set(+m[1]!, m[2]!); }
const impl = new Map<number, string[]>();
for (const f of tsFiles('src/engine')) {
  const ls = lines(f);
  let inScale = false;
  ls.forEach((l, i) => {
    if (/const a = s\.cfg\.ascension/.test(l)) inScale = true;
    if (inScale && /^}/.test(l)) inScale = false;
    const re = inScale ? /\ba\s*>=\s*(\d+)/g : /ascension\s*>=\s*(\d+)/g;
    for (const m of l.matchAll(re)) if (!/cur < 15|r\.ascension >= cur/.test(l)) (impl.get(+m[1]!) ?? impl.set(+m[1]!, []).get(+m[1]!)!).push(`${f}:${i + 1} \`${l.trim().slice(0, 90)}\``);
  });
}
for (const e of c.enemies.values()) for (const ph of e.phases ?? []) if (ph.minAscension) (impl.get(ph.minAscension) ?? impl.set(ph.minAscension, []).get(ph.minAscension)!).push(`${loc(e.id)} phase "${ph.name}" on ${e.id}`);
{ // commander-row enemies bypass scaleEnemyHp(): api.ts only applies the boss multiplier
  const cmdRow = [...c.encounters.values()].filter((e) => e.tier !== 'boss' && reach.encounters.has(e.id) && e.enemies.some((x) => (x.row ?? c.enemies.get(x.id)?.row) === 'commander'));
  for (const tier of ['normal', 'elite'] as const) {
    const hit = cmdRow.filter((e) => e.tier === tier).map((e) => e.id);
    const lv = tier === 'normal' ? 2 : 3;
    if (hit.length && !text('src/engine/combat/api.ts').includes('scaleEnemyHp(')) report('9 ascension', 'ERROR', `A${lv} HP bonus NOT applied to ${hit.length} ${tier} encounters whose enemy is commander-row (createCombat only scales tier 'boss', ${at('src/engine/combat/api.ts', "cfg.ascension >= 4 && def.tier === 'boss'")}): ${hit.join(', ')}`);
  }
}
const inGameDesc = tsFiles('src/game').some((f) => text(f).includes('ASCENSION_TEXT') || [...docAsc.values()].some((d) => d.length > 4 && text(f).includes(d.slice(0, 6))));
for (let lv = 1; lv <= 15; lv++) report('9 ascension', impl.has(lv) ? 'INFO' : 'ERROR', `A${lv} doc: "${docAsc.get(lv) ?? '—'}" | code: ${impl.get(lv)?.join(' ; ') ?? 'NO IMPLEMENTATION'}`);
if (!inGameDesc) report('9 ascension', 'WARN', `no per-level ascension description is shown in game — select screen shows only the number (${at('src/game/scenes/select.ts', 'setAsc(v: number)')})`);

// ═════════════ 10. settings / codex ═════════════
const stIface = text('src/game/state.ts').match(/export interface Settings \{([\s\S]*?)\n\}/)?.[1] ?? '';
const keys = [...stIface.matchAll(/^\s*(\w+)\s*:/gm)].map((m) => m[1]!);
const gameFiles = [...tsFiles('src/game'), 'src/main.ts'].filter((f) => !f.endsWith('scenes/settings.ts'));
const settingsUi = text('src/game/scenes/settings.ts');
// lastSeenVersion is bookkeeping for 命书新章 (ui/changelog.ts), not a player setting
for (const k of keys) {
  const readers = gameFiles.filter((f) => new RegExp(`\\.${k}\\b`).test(text(f)));
  const ui = new RegExp(`st\\.${k}\\b`).test(settingsUi);
  if (!readers.length) report('10 settings/codex', 'ERROR', `setting '${k}' is never read outside the settings screen${ui ? ' (toggle does nothing)' : ' and has no control'} (${at('src/game/state.ts', new RegExp(`^\\s*${k}:`))}${ui ? `; ${at('src/game/scenes/settings.ts', `st.${k}`)}` : ''})`);
  else if (!ui && k !== 'lastSeenVersion' && k !== 'skippedVersion') report('10 settings/codex', 'WARN', `setting '${k}' has no control in the settings screen (${at('src/game/state.ts', new RegExp(`^\\s*${k}:`))})`);
}
const codex = 'src/game/scenes/codex.ts';
for (const lore of ['world', 'rules']) { const f = path.join(DATA_DIR, 'lore', `${lore}.json`); const n = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as unknown[]).length : 0; report('10 settings/codex', n ? 'INFO' : 'ERROR', `codex tab '${lore}': ${n} entries (${rel(f)})`); }
const codexCards = [...c.cards.values()].filter((x) => x.pool !== false && !['token', 'special', 'basic'].includes(x.rarity) && x.type !== 'status' && x.type !== 'curse');
const codexBad = { cards: codexCards.filter((x) => !reach.cards.has(x.id)).map((x) => x.id), relics: [...c.relics.values()].filter((x) => !reach.relics.has(x.id)).map((x) => x.id), enemies: [...c.enemies.values()].filter((e) => e.tier !== 'minion' && !e.variantOf && !e.id.startsWith('sandbox') && !reach.enemies.has(e.id)).map((e) => e.id) };
for (const [k, v] of Object.entries(codexBad)) report('10 settings/codex', v.length ? 'ERROR' : 'INFO', `codex '${k}': ${v.length ? `${v.length} entries can never be discovered → 100% impossible: ${v.join(', ')}` : 'all entries discoverable'} (${at(codex, `case '${k}'`)})`);
{
  const nonMinionCodex = [...c.enemies.values()].filter((e) => e.tier === 'minion' && reach.enemies.has(e.id)).length;
  report('10 settings/codex', 'INFO', `codex 'enemies' hides ${nonMinionCodex} minions until discovered; codex 'history' empty until first run; 'fate' static`);
}

// ───────────── output ─────────────
let errs = 0, warns = 0;
for (const cat of Object.keys(findings).sort((a, b) => parseInt(a) - parseInt(b))) {
  console.log(`\n══ ${cat} ══`);
  for (const f of findings[cat]!.sort((a, b) => ['ERROR', 'WARN', 'INFO'].indexOf(a.sev) - ['ERROR', 'WARN', 'INFO'].indexOf(b.sev))) {
    if (f.sev === 'ERROR') errs++; if (f.sev === 'WARN') warns++;
    console.log(`  ${f.sev.padEnd(5)} ${f.msg}`);
  }
}
console.log(`\nreachable: cards ${reach.cards.size}/${c.cards.size} · relics ${reach.relics.size}/${c.relics.size} · potions ${reach.potions.size}/${c.potions.size} · enemies ${reach.enemies.size}/${c.enemies.size} · encounters ${reach.encounters.size}/${c.encounters.size} · events ${reach.events.size}/${c.events.size} · commanders ${reachCmd.size}/${c.commanders.size} · lieutenants ${reach.lts.size}/${c.lieutenants.size}`);
console.log(`${errs} error(s), ${warns} warning(s)`);
if (process.argv.includes('--ci') && errs) process.exit(1);
