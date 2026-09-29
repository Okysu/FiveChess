/**
 * Scripts behind the 1.1 bosses and elites (百鬼夜行). Each enemy has one mechanic; its data (src/data/enemies)
 * calls these with `{ op: 'script', id, args }` from moves and passives. State lives in the enemy's `mem`.
 */
import { content } from '../content';
import type { Effect } from '../defs';
import { pick, shuffle } from '../rng';
import type { CardInst, CombatState, Unit } from './state';
import { alive, unit, unitsOf, emptySlots, FRONT } from './board';
import { applyStatus, cardDef, emit, fire, handLimit, newUid, registerScript, removeFromBoard, spliceNext, type FxTask } from './core';
import { chooseTarget } from './enemycast';

const selfOf = (s: CombatState, task: FxTask) => unit(s, task.ctx.source);
/** the enemy itself even after it left the board (death triggers resolve once it is gone) */
const rawSelf = (s: CombatState, task: FxTask): Unit | undefined => (task.ctx.source == null ? undefined : s.units[task.ctx.source]);
const memOf = (u: Unit) => (u.mem ??= {});
const num = (v: unknown, d = 0) => (typeof v === 'number' ? v : d);
const shout = (s: CombatState, u: Unit | undefined, text: string) => emit(s, { t: 'shout', uid: u?.uid ?? null, text });
/** the intent box re-reads the move name (it may name a remembered card) */
const refreshIntent = (s: CombatState, u: Unit) => { if (u.intent) emit(s, { t: 'intent', uid: u.uid, move: u.intent.move, target: u.intent.target }); };

// ───────────── 拓碑鬼·千拓: rubs the last card you played and plays it back at you ─────────────

const RUBBABLE = new Set(['tactic', 'unit', 'response', 'delay']);

registerScript('rubRecord', (s, task) => {
  const u = selfOf(s, task);
  const card = task.ctx.event?.card;
  if (!alive(u) || !card) return;
  const def = cardDef(card);
  if (!RUBBABLE.has(def.type) || def.unplayable) return;
  const m = memOf(u);
  m.rub = card.id;
  m.rubUp = card.up ? 1 : 0;
  refreshIntent(s, u);
});

registerScript('rubCast', (s, task, args) => {
  const u = selfOf(s, task);
  if (!alive(u)) return;
  const id = u.mem?.rub;
  const fallback = (args.fallback as Effect[] | undefined) ?? [];
  if (typeof id !== 'string' || !content().cards.has(id)) { spliceNext(task, fallback); return; }
  const card: CardInst = { uid: newUid(s), id, up: u.mem?.rubUp === 1 };
  const target = chooseTarget(s, card);
  if (target === undefined) { spliceNext(task, fallback); return; }
  const times = num(args.times, 1);
  emit(s, { t: 'play', side: 'enemy', card, target });
  s.limbo.push(card);
  if (times > 1) spliceNext(task, [{ op: 'script', id: 'rubCast', args: { ...args, times: times - 1 } }]);
  s.tasks.push({ k: 'chain', stage: 'window', links: [{ kind: 'card', side: 'enemy', card, target, slot: null, x: 0 }], passes: 0, origin: 'enemy' });
});

// ───────────── 纸扎王: one 护符 per paper servant standing ─────────────

registerScript('paperWard', (s, task, args) => {
  const u = selfOf(s, task);
  if (!alive(u)) return;
  const n = unitsOf(s, 'enemy').length;
  const next = args.mode === 'sync' ? Math.min(u.ward, n) : Math.min(num(args.cap, 4), n);
  if (next !== u.ward) { u.ward = next; emit(s, { t: 'ward', target: u.uid, ward: u.ward }); }
});

// ───────────── 蠹鱼王: swallows cards off your draw pile, coughs them up when hurt ─────────────

function bellyOf(s: CombatState) { return (s.sides.enemy.belly ??= []); }

registerScript('devour', (s, task, args) => {
  const u = selfOf(s, task);
  if (!alive(u)) return;
  const belly = bellyOf(s);
  let took = 0;
  for (let k = 0; k < num(args.n, 1); k++) {
    if (!s.draw.length) {
      if (!s.discard.length) break;
      s.draw = shuffle(s.rng, s.discard.splice(0));
      emit(s, { t: 'shuffle', n: s.draw.length });
      fire(s, 'shuffled', { side: 'player' });
    }
    const c = s.draw.pop()!;
    belly.push({ uid: c.uid, id: c.id, up: c.up });
    took++;
  }
  if (!took) return;
  emit(s, { t: 'belly', uid: u.uid, n: took, total: belly.length });
  emit(s, { t: 'log', text: `${u.name}吞下了你牌库顶的 ${took} 张牌（腹中 ${belly.length} 张）` });
});

function spit(s: CombatState, u: Unit, n: number) {
  const belly = bellyOf(s);
  let back = 0;
  for (let k = 0; k < n && belly.length; k++) {
    const c = belly.pop()!;
    const to = s.hand.length < handLimit(s) ? 'hand' : 'discard';
    (to === 'hand' ? s.hand : s.discard).push(c);
    emit(s, { t: 'create', card: c, to });
    back++;
  }
  if (back) emit(s, { t: 'belly', uid: u.uid, n: -back, total: belly.length });
  return back;
}

registerScript('spit', (s, task, args) => {
  const u = rawSelf(s, task);
  if (!u) return;
  const n = args.n === 'all' ? bellyOf(s).length : num(args.n, 1);
  if (spit(s, u, n)) shout(s, u, `${u.name}吐出了吞下的牌`);
});

/** every `every` damage it takes, one swallowed card comes back to your hand */
registerScript('bellyHit', (s, task, args) => {
  const u = selfOf(s, task);
  if (!u) return;
  const m = memOf(u);
  const every = num(args.every, 50);
  m.hurt = num(m.hurt) + (task.ctx.event?.amount ?? 0);
  let back = 0;
  while (num(m.hurt) >= every && bellyOf(s).length) { m.hurt = num(m.hurt) - every; back += spit(s, u, 1); }
  if (!bellyOf(s).length) m.hurt = Math.min(num(m.hurt), every - 1);
  if (back) shout(s, u, `${u.name}吃痛，吐出了 ${back} 张牌`);
});

// ───────────── 浑天仪: the ring in front comes round each turn ─────────────

registerScript('ringTurn', (s, task, args) => {
  const ids = (args.rings as string[] | undefined) ?? [];
  const rings = unitsOf(s, 'enemy').filter((u) => ids.includes(u.def)).sort((a, b) => ids.indexOf(a.def) - ids.indexOf(b.def));
  if (!rings.length) return;
  const sd = s.sides.enemy;
  const front = rings.find((r) => r.row === 'front');
  const next = rings[((front ? rings.indexOf(front) : -1) + 1) % rings.length]!;
  if (next === front) return;
  if (front && next.row === 'back') {
    // swap places
    const fs = front.slot, bs = next.slot;
    sd.front[fs] = next.uid; sd.back[bs] = front.uid;
    next.row = 'front'; next.slot = fs; front.row = 'back'; front.slot = bs;
    emit(s, { t: 'move', uid: next.uid, row: 'front', slot: fs });
    emit(s, { t: 'move', uid: front.uid, row: 'back', slot: bs });
  } else if (!front && next.row === 'back') {
    const free = emptySlots(s, 'enemy', 'front');
    if (!free.length) return;
    const mid = (FRONT - 1) / 2;
    const ns = [...free].sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid))[0]!;
    sd.back[next.slot] = null; sd.front[ns] = next.uid;
    next.row = 'front'; next.slot = ns;
    emit(s, { t: 'move', uid: next.uid, row: 'front', slot: ns });
  }
  emit(s, { t: 'log', text: `浑天仪转动：${next.name}转到了正面` });
});

// ───────────── 铁锁典狱: the next cards you draw cost more this turn ─────────────

registerScript('lockTop', (s, task, args) => {
  const n = num(args.n, 2), amount = num(args.amount, 1);
  const top = s.draw.slice(-n);
  for (const c of top) { c.costMod = (c.costMod ?? 0) + amount; c.costModUntil = 'turn'; }
  if (top.length) emit(s, { t: 'log', text: `铁锁缠上了你牌库顶的 ${top.length} 张牌（下回合费用 +${amount}）` });
});

// ───────────── 沉钟: hit it hard enough before it tolls and the toll is cut off ─────────────

registerScript('bellHit', (s, task, args) => {
  const u = selfOf(s, task);
  if (!alive(u)) return;
  const m = memOf(u);
  m.hit = num(m.hit) + (task.ctx.event?.amount ?? 0);
  if (m.hit >= num(args.need, 30) && u.intent?.move === args.move && !m.cracked && !(u.statuses.stun ?? 0)) {
    m.cracked = 1;
    applyStatus(s, u.uid, 'stun', 1, null);
    shout(s, u, '钟声被打断了！');
  }
});

registerScript('memReset', (s, task, args) => {
  const u = selfOf(s, task);
  if (!u?.mem) return;
  for (const k of (args.keys as string[] | undefined) ?? []) delete u.mem[k];
});

// ───────────── 无面书吏: erases the words on your relics until it dies ─────────────

registerScript('sealRelic', (s, task) => {
  const u = selfOf(s, task);
  if (!alive(u)) return;
  const open = s.relics.filter((r) => !r.disabled);
  if (!open.length) return;
  const r = pick(s.rng, open)!;
  r.disabled = true;
  const m = memOf(u);
  m.sealed = [...String(m.sealed ?? '').split(',').filter(Boolean), r.id].join(',');
  emit(s, { t: 'relicSeal', id: r.id, sealed: true });
  shout(s, u, `「${content().relic(r.id).name}」上的字被抹去了`);
});

registerScript('unsealAll', (s, task) => {
  const u = rawSelf(s, task);
  if (!u?.mem?.sealed) return;
  for (const id of String(u.mem.sealed).split(',').filter(Boolean)) {
    const r = s.relics.find((x) => x.id === id);
    if (r?.disabled) { r.disabled = false; emit(s, { t: 'relicSeal', id, sealed: false }); }
  }
  u.mem.sealed = '';
});

// ───────────── 偷命贼: steals gold each turn; flees with it, or drops it all when killed ─────────────

registerScript('steal', (s, task, args) => {
  const u = selfOf(s, task);
  if (!alive(u)) return;
  const n = num(args.n, 10);
  s.goldGained -= n;
  memOf(u).stolen = num(u.mem!.stolen) + n;
  shout(s, u, `${u.name}偷走了 ${n} 金（共 ${u.mem!.stolen} 金）`);
});

registerScript('returnLoot', (s, task, args) => {
  const u = rawSelf(s, task);
  const stolen = num(u?.mem?.stolen);
  const n = stolen + num(args.bonus);
  if (!n) return;
  s.goldGained += n;
  emit(s, { t: 'log', text: `${u?.name ?? ''}掉出了 ${n} 金` });
});

registerScript('flee', (s, task) => {
  const u = selfOf(s, task);
  if (!alive(u)) return;
  shout(s, u, `${u.name}带着偷来的金子逃走了`);
  removeFromBoard(s, u);
  emit(s, { t: 'death', uid: u.uid });
});

// ───────────── shared ─────────────

/** a line shouted by the enemy (edict broken …) */
registerScript('say', (s, task, args) => shout(s, selfOf(s, task), String(args.text ?? '')));
