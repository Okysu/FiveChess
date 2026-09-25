import type {
  CardDef, CommanderDef, EncounterDef, EnemyDef, EventDef, LieutenantDef, PotionDef, RelicDef, CardFilter, Color,
} from './defs';

export interface ContentBundle {
  cards: CardDef[];
  commanders: CommanderDef[];
  lieutenants: LieutenantDef[];
  enemies: EnemyDef[];
  encounters: EncounterDef[];
  relics: RelicDef[];
  potions: PotionDef[];
  events: EventDef[];
}

export class Content {
  readonly cards = new Map<string, CardDef>();
  readonly commanders = new Map<string, CommanderDef>();
  readonly lieutenants = new Map<string, LieutenantDef>();
  readonly enemies = new Map<string, EnemyDef>();
  readonly encounters = new Map<string, EncounterDef>();
  readonly relics = new Map<string, RelicDef>();
  readonly potions = new Map<string, PotionDef>();
  readonly events = new Map<string, EventDef>();
  private upCache = new Map<string, CardDef>();

  constructor(b: ContentBundle) {
    for (const c of b.cards) this.cards.set(c.id, c);
    for (const c of b.commanders) this.commanders.set(c.id, c);
    for (const c of b.lieutenants) this.lieutenants.set(c.id, c);
    for (const c of b.enemies) this.enemies.set(c.id, c);
    for (const c of b.encounters) this.encounters.set(c.id, c);
    for (const c of b.relics) this.relics.set(c.id, c);
    for (const c of b.potions) this.potions.set(c.id, c);
    for (const c of b.events) this.events.set(c.id, c);
  }

  card(id: string, up = false): CardDef {
    const base = this.cards.get(id);
    if (!base) throw new Error(`unknown card ${id}`);
    if (!up || !base.upgrade) return base;
    const hit = this.upCache.get(id);
    if (hit) return hit;
    const u = base.upgrade;
    const merged: CardDef = {
      ...base,
      name: u.name ?? base.name + '+',
      text: u.text ?? base.text,
      cost: u.cost ?? base.cost,
      vars: { ...(base.vars ?? {}), ...(u.vars ?? {}) },
      keywords: u.keywords ?? base.keywords,
      effects: u.effects ?? base.effects,
      target: u.target ?? base.target,
      onSacrifice: u.onSacrifice ?? base.onSacrifice,
      inHand: u.inHand ?? base.inHand,
      windowOnly: u.windowOnly ?? base.windowOnly,
      unit: base.unit ? { ...base.unit, ...(u.unit ?? {}) } : undefined,
      equip: base.equip ? { ...base.equip, ...(u.equip ?? {}) } : undefined,
      delay: base.delay ? { ...base.delay, ...(u.delay ?? {}) } : undefined,
      field: base.field ? { ...base.field, ...(u.field ?? {}) } : undefined,
    };
    this.upCache.set(id, merged);
    return merged;
  }

  hasCard(id: string) { return this.cards.has(id); }

  enemy(id: string): EnemyDef {
    const e = this.enemies.get(id);
    if (!e) throw new Error(`unknown enemy ${id}`);
    return e;
  }

  commander(id: string): CommanderDef {
    const c = this.commanders.get(id);
    if (!c) throw new Error(`unknown commander ${id}`);
    return c;
  }

  relic(id: string): RelicDef {
    const r = this.relics.get(id);
    if (!r) throw new Error(`unknown relic ${id}`);
    return r;
  }

  /** cards matching a filter; `own` faction resolves to the given colors */
  filterCards(f: CardFilter, own: Color[] = [], poolOnly = true): CardDef[] {
    const out: CardDef[] = [];
    for (const c of this.cards.values()) {
      if (poolOnly && (c.pool === false || c.rarity === 'basic' || c.rarity === 'token' || c.rarity === 'special')) continue;
      if (poolOnly && (c.type === 'status' || c.type === 'curse')) continue;
      if (matchCard(c, f, own)) out.push(c);
    }
    return out;
  }
}

export function matchCard(c: CardDef, f: CardFilter, own: Color[] = []): boolean {
  if (f.id && c.id !== f.id) return false;
  if (f.type) {
    const ts = Array.isArray(f.type) ? f.type : [f.type];
    if (!ts.includes(c.type)) return false;
  }
  if (f.faction) {
    const fs = f.faction === 'own' ? [...own, 'N' as Color] : Array.isArray(f.faction) ? f.faction : [f.faction];
    if (!fs.includes(c.faction)) return false;
  }
  if (f.rarity) {
    const rs = Array.isArray(f.rarity) ? f.rarity : [f.rarity];
    if (!rs.includes(c.rarity)) return false;
  }
  if (f.keyword && !(c.keywords ?? []).includes(f.keyword) && !(c.unit?.keywords ?? []).includes(f.keyword)) return false;
  const cost = c.cost.g === 'X' ? 0 : c.cost.g + (c.cost.c?.length ?? 0);
  if (f.maxCost !== undefined && cost > f.maxCost) return false;
  if (f.minCost !== undefined && cost < f.minCost) return false;
  return true;
}

let active: Content | null = null;
export function setContent(c: Content) { active = c; }
export function content(): Content {
  if (!active) throw new Error('content not loaded');
  return active;
}
