/**
 * Validates all content JSON: zod schemas, id uniqueness, cross references, vars, text markup.
 * Exit code 1 on any error (wired into `npm run build`).
 */
import path from 'node:path';
import { z } from 'zod';
import { readBundle } from './load-content';
import { zBlessing, zCard, zCommander, zEnemy, zEncounter, zEvent, zLieutenant, zPotion, zRelic } from '../src/engine/schema';
import { TERM_NAMES } from '../src/engine/glossary';
import type { Effect, RunEffect, Trigger, JudgeBranches } from '../src/engine/defs';

const errors: string[] = [];
const warn: string[] = [];
const { bundle, files } = readBundle();

// 1) schema per file
for (const [file, data] of Object.entries(files)) {
  const p = file.replace(/\\/g, '/');
  if (p.includes('/lore/')) continue;
  let schema: z.ZodTypeAny | null = null;
  if (p.includes('/cards/')) schema = zCard;
  else if (p.includes('/enemies/')) schema = zEnemy;
  else if (p.endsWith('/commanders.json')) schema = zCommander;
  else if (p.endsWith('/lieutenants.json')) schema = zLieutenant;
  else if (p.includes('/encounters')) schema = zEncounter;
  else if (p.includes('/relics')) schema = zRelic;
  else if (p.endsWith('/potions.json')) schema = zPotion;
  else if (p.includes('/events')) schema = zEvent;
  else if (p.endsWith('/blessings.json')) schema = zBlessing;
  else if (p.endsWith('/changelog.json')) continue; // checked by scripts/changelog.ts
  if (!schema) { warn.push(`unrecognised data file ${path.basename(file)}`); continue; }
  if (!Array.isArray(data)) { errors.push(`${file}: top level must be an array`); continue; }
  data.forEach((item, i) => {
    const r = schema!.safeParse(item);
    if (!r.success) {
      const id = (item as { id?: string }).id ?? `#${i}`;
      for (const iss of r.error.issues.slice(0, 6)) errors.push(`${path.basename(file)} ${id}: ${iss.path.join('.')} — ${iss.message}`);
    }
  });
}

// 2) uniqueness
function uniq(kind: string, ids: string[]) {
  const seen = new Set<string>();
  for (const id of ids) { if (seen.has(id)) errors.push(`duplicate ${kind} id: ${id}`); seen.add(id); }
}
uniq('card', bundle.cards.map((c) => c.id));
uniq('enemy', bundle.enemies.map((c) => c.id));
uniq('commander', bundle.commanders.map((c) => c.id));
uniq('lieutenant', bundle.lieutenants.map((c) => c.id));
uniq('encounter', bundle.encounters.map((c) => c.id));
uniq('relic', bundle.relics.map((c) => c.id));
uniq('potion', bundle.potions.map((c) => c.id));
uniq('event', bundle.events.map((c) => c.id));

const cardIds = new Set(bundle.cards.map((c) => c.id));
const enemyIds = new Set(bundle.enemies.map((c) => c.id));
const relicIds = new Set(bundle.relics.map((c) => c.id));
const potionIds = new Set(bundle.potions.map((c) => c.id));
const encIds = new Set(bundle.encounters.map((c) => c.id));
const ltIds = new Set(bundle.lieutenants.map((c) => c.id));

// 3) walk effects for references & vars
function walkEffects(where: string, effs: Effect[] | undefined, vars: Record<string, number> | undefined, allowVars = true) {
  if (!effs) return;
  const checkVal = (v: unknown) => {
    if (typeof v === 'string' && v.startsWith('$')) {
      const k = v.slice(1);
      if (k !== 'x' && k !== 'atk' && (!vars || vars[k] === undefined)) errors.push(`${where}: var ${v} not defined${allowVars ? '' : ' (no vars here)'}`);
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) checkVal(x);
  };
  for (const e of effs) {
    checkVal(e);
    switch (e.op) {
      case 'summon': if (!cardIds.has(e.unit) && !enemyIds.has(e.unit)) errors.push(`${where}: summon unknown unit ${e.unit}`); break;
      case 'create': if (typeof e.card === 'string' && !cardIds.has(e.card)) errors.push(`${where}: create unknown card ${e.card}`); break;
      case 'delay': case 'equip': case 'field': if (!cardIds.has(e.card)) errors.push(`${where}: ${e.op} unknown card ${e.card}`); break;
      case 'transform': if (!cardIds.has(e.into) && !enemyIds.has(e.into)) errors.push(`${where}: transform unknown ${e.into}`); break;
      case 'repeat': walkEffects(where, e.effects, vars, allowVars); break;
      case 'if': walkEffects(where, e.then, vars, allowVars); walkEffects(where, e.else, vars, allowVars); break;
      case 'forEach': walkEffects(where, e.effects, vars, allowVars); break;
      case 'choose': for (const o of e.options) walkEffects(where, o.effects, vars, allowVars); break;
      case 'counter': walkEffects(where, e.then, vars, allowVars); break;
      case 'judge': walkBranches(where, e.branches, vars, allowVars); break;
      case 'discard': case 'exhaustCards': walkEffects(where, e.each, vars, allowVars); break;
      case 'script': if (!['bossCast'].includes(e.id)) warn.push(`${where}: script ${e.id} must be registered in code`); break;
    }
  }
}
function walkBranches(where: string, b: JudgeBranches | undefined, vars: Record<string, number> | undefined, allowVars: boolean) {
  if (!b) return;
  for (const k of ['sun', 'thunder', 'moon', 'mountain', 'yang', 'yin', 'high', 'low', 'always'] as const) walkEffects(where, b[k], vars, allowVars);
  for (const r of b.ranks ?? []) walkEffects(where, r.effects, vars, allowVars);
}
function walkTriggers(where: string, ts: Trigger[] | undefined, vars?: Record<string, number>) {
  for (const t of ts ?? []) walkEffects(where, t.effects, vars);
}

const TEXT_TERM = /\[([^\]]+)\]/g;
const TEXT_VAR = /\{([a-zA-Z0-9_]+)\}/g;
const ICONS = new Set(['R', 'B', 'G', 'Y', 'P', 'N', 'sun', 'moon', 'thunder', 'mountain', 'x', 'X']);
function checkText(where: string, text: string, vars?: Record<string, number>) {
  for (const m of text.matchAll(TEXT_TERM)) if (!TERM_NAMES[m[1]!]) errors.push(`${where}: unknown term [${m[1]}]`);
  for (const m of text.matchAll(TEXT_VAR)) {
    const k = m[1]!;
    if (ICONS.has(k)) continue;
    if (!vars || vars[k] === undefined) errors.push(`${where}: text var {${k}} not in vars`);
  }
}

for (const c of bundle.cards) {
  const where = `card ${c.id}`;
  const vars = { ...(c.vars ?? {}) };
  walkEffects(where, c.effects, vars);
  walkEffects(where, c.onSacrifice, vars);
  walkTriggers(where, c.inHand, vars);
  walkTriggers(where, c.unit?.triggers, vars);
  walkTriggers(where, c.equip?.triggers, vars);
  walkTriggers(where, c.field?.triggers, vars);
  walkBranches(where, c.delay?.branches, vars, true);
  checkText(where, c.text, vars);
  if (c.upgrade) {
    const uv = { ...vars, ...(c.upgrade.vars ?? {}) };
    walkEffects(where + '+', c.upgrade.effects ?? c.effects, uv);
    walkTriggers(where + '+', c.upgrade.unit?.triggers, uv);
    walkBranches(where + '+', c.upgrade.delay?.branches, uv, true);
    checkText(where + '+', c.upgrade.text ?? c.text, uv);
  }
  if (c.type === 'unit' && !c.unit) errors.push(`${where}: unit card missing unit stats`);
  if (c.type === 'equip' && !c.equip) errors.push(`${where}: equip card missing equip stats`);
  if (c.type === 'delay' && !c.delay) errors.push(`${where}: delay card missing delay stats`);
  if (c.type === 'field' && !c.field) errors.push(`${where}: field card missing field stats`);
  if (c.type === 'response' && !(c.keywords ?? []).includes('response')) errors.push(`${where}: response card must have keyword response`);
  if (/[a-zA-Z]{3,}/.test(c.name)) errors.push(`${where}: name should be Chinese`);
}
for (const cm of bundle.commanders) {
  for (const id of cm.deck) if (!cardIds.has(id)) errors.push(`commander ${cm.id}: deck card ${id} missing`);
  if (!relicIds.has(cm.relic)) errors.push(`commander ${cm.id}: relic ${cm.relic} missing`);
  for (const sk of cm.skills) { walkEffects(`skill ${sk.id}`, sk.effects, {}); walkTriggers(`skill ${sk.id}`, sk.triggers, {}); walkEffects(`skill ${sk.id}`, sk.awaken?.effects, {}); walkTriggers(`skill ${sk.id}`, sk.awaken?.becomes?.triggers, {}); walkEffects(`skill ${sk.id}`, sk.awaken?.becomes?.effects, {}); checkText(`skill ${sk.id}`, sk.text); }
}
for (const l of bundle.lieutenants) { walkEffects(`lt ${l.id}`, l.skill.effects, {}); walkTriggers(`lt ${l.id}`, l.skill.triggers, {}); checkText(`lt ${l.id}`, l.skill.text); }
for (const e of bundle.enemies) {
  const allMoves = { ...e.moves };
  for (const ph of e.phases ?? []) Object.assign(allMoves, ph.moves ?? {});
  for (const [mid, mv] of Object.entries(allMoves)) walkEffects(`enemy ${e.id}.${mid}`, mv.effects, { atk: e.atk });
  walkTriggers(`enemy ${e.id}`, e.passives, { atk: e.atk });
  const checkAI = (ai: typeof e.ai, moves: Record<string, unknown>) => {
    const names: string[] = [];
    if (ai.type === 'cycle') names.push(...ai.sequence);
    if (ai.type === 'weighted') names.push(...Object.keys(ai.weights));
    if (ai.type === 'script') { names.push(...(ai.first ?? []), ...(ai.rules ?? []).map((r) => r.move)); checkAI(ai.then, moves); }
    for (const n of names) if (!moves[n]) errors.push(`enemy ${e.id}: ai references missing move ${n}`);
  };
  checkAI(e.ai, e.moves);
  for (const ph of e.phases ?? []) checkAI(ph.ai, { ...e.moves, ...(ph.moves ?? {}) });
  for (const id of e.deck ?? []) if (!cardIds.has(id)) errors.push(`enemy ${e.id}: deck card ${id} missing`);
}
for (const en of bundle.encounters) for (const x of en.enemies) if (!enemyIds.has(x.id)) errors.push(`encounter ${en.id}: enemy ${x.id} missing`);
for (const r of bundle.relics) { walkTriggers(`relic ${r.id}`, r.triggers, {}); walkRun(`relic ${r.id}`, r.onPickup); checkText(`relic ${r.id}`, r.text); }
for (const p of bundle.potions) { walkEffects(`potion ${p.id}`, p.effects, {}); walkRun(`potion ${p.id}`, p.outOfCombat); checkText(`potion ${p.id}`, p.text); }
for (const ev of bundle.events) {
  const pages = new Set((ev.pages ?? []).map((p) => p.id));
  for (const o of [...ev.options, ...(ev.pages ?? []).flatMap((p) => p.options)]) {
    walkRun(`event ${ev.id}`, o.effects);
    if (o.next && !pages.has(o.next)) errors.push(`event ${ev.id}: next page ${o.next} missing`);
  }
}
function walkRun(where: string, effs: RunEffect[] | undefined) {
  for (const e of effs ?? []) {
    if (e.op === 'addCard' && e.card && !cardIds.has(e.card)) errors.push(`${where}: addCard unknown ${e.card}`);
    if (e.op === 'addRelic' && e.relic && !relicIds.has(e.relic)) errors.push(`${where}: addRelic unknown ${e.relic}`);
    if (e.op === 'addPotion' && e.potion && !potionIds.has(e.potion)) errors.push(`${where}: addPotion unknown ${e.potion}`);
    if (e.op === 'fight' && !encIds.has(e.encounter) && !/^random:(normal|elite)$/.test(e.encounter)) errors.push(`${where}: fight unknown encounter ${e.encounter}`);
    if (e.op === 'fight' && e.encounter === 'sandbox') errors.push(`${where}: fight uses the test-only sandbox encounter`);
    if (e.op === 'lieutenant' && e.id && !ltIds.has(e.id)) errors.push(`${where}: unknown lieutenant ${e.id}`);
    if (e.op === 'chance') { walkRun(where, e.then); walkRun(where, e.else); }
  }
}

// 4) summary
const byFaction: Record<string, number> = {};
for (const c of bundle.cards) if (!['basic', 'token', 'special'].includes(c.rarity) && !['status', 'curse'].includes(c.type)) byFaction[c.faction] = (byFaction[c.faction] ?? 0) + 1;
const up = bundle.cards.filter((c) => c.upgrade);
const qual = up.filter((c) => c.upgrade?.qualitative).length;
const summary = {
  cards: bundle.cards.length, poolByFaction: byFaction, statusCurse: bundle.cards.filter((c) => c.type === 'status' || c.type === 'curse').length,
  tokens: bundle.cards.filter((c) => c.rarity === 'token').length, upgrades: up.length, qualitativeUpgrades: qual,
  commanders: bundle.commanders.length, lieutenants: bundle.lieutenants.length, enemies: bundle.enemies.length,
  elites: bundle.enemies.filter((e) => e.tier === 'elite').length, bosses: bundle.enemies.filter((e) => e.tier === 'boss').length,
  encounters: bundle.encounters.length, relics: bundle.relics.length, ruleRelics: bundle.relics.filter((r) => r.ruleChanging).length,
  potions: bundle.potions.length, events: bundle.events.length,
};
console.log(JSON.stringify(summary, null, 1));
for (const w of warn) console.warn('WARN', w);
if (errors.length) {
  for (const e of errors.slice(0, 200)) console.error('ERR ', e);
  console.error(`\n${errors.length} error(s)`);
  process.exit(1);
}
console.log('content OK');
