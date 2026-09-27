/**
 * Card renderer — every visual is a generated woodblock texture (docs/美术风格圣经.md §4).
 * Base size 300×420. Layers: paper body → art window (masked) → school frame (9-slice) → rules box →
 * name ribbon → rarity gem / response seal → cost medallion + source pips → stat badges.
 */
import { Container, Sprite, Text, Texture } from 'pixi.js';
import type { CardDef, Color } from '../../engine/defs';
import { content } from '../../engine/content';
import { assets, K } from '../assets';
import { FONT_NUM, FONT_TITLE } from './theme';
import { richTexture, type VarInfo } from './richtext';
import { COLOR_INFO } from '../../engine/glossary';
import { WB, uiCover, uiFill, uiSprite, nine, gem, pip, frame, maskPoly, maskRect } from './skin';

export const CARD_W = 300;
export const CARD_H = 420;
const ART = { x: 26, y: 28, w: 248, h: 180 };
// rules text sits straight on the card paper: from under the name ribbon to the frame's bottom border
const RULES = { x: 42, y: 262, w: 216, h: 120 };
const RIBBON_Y = 200;

export interface CardLive {
  cost?: { g: number; c: Color[]; x: boolean };
  payable?: boolean;
  missing?: Color[];
  vars?: Record<string, VarInfo>;
  atk?: number;
  hp?: number;
}

/** polygon approximating the art-window shape for each card type (used as an invisible mask) */
function artWindow(type: CardDef['type']): number[] {
  const { x, y, w, h } = ART;
  const pts: number[] = [];
  const arc = (cx: number, cy: number, r: number, a0: number, a1: number, n = 10) => { for (let i = 0; i <= n; i++) { const a = a0 + ((a1 - a0) * i) / n; pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r); } };
  switch (type) {
    case 'unit':
      pts.push(x, y + h);
      arc(x + 50, y + 50, 50, Math.PI, Math.PI * 1.5);
      arc(x + w - 50, y + 50, 50, Math.PI * 1.5, Math.PI * 2);
      pts.push(x + w, y + h);
      return pts;
    case 'response':
      return [x + 20, y, x + w - 20, y, x + w, y + 20, x + w, y + h - 20, x + w - 20, y + h, x + 20, y + h, x, y + h - 20, x, y + 20];
    case 'delay':
      return [x, y, x + w, y, x + w - 22, y + h / 2, x + w, y + h, x, y + h, x + 22, y + h / 2];
    case 'equip':
      pts.push(x, y + h, x, y + 36);
      arc(x + w / 2, y + 36 + w * 0.9 - 62, w * 0.9, Math.PI * 1.36, Math.PI * 1.64, 16);
      pts.push(x + w, y + 36, x + w, y + h);
      return pts;
    default:
      return [x, y, x + w, y, x + w, y + h, x, y + h];
  }
}

export class CardView extends Container {
  def: CardDef;
  readonly cardId: string;
  readonly up: boolean;
  cardUid: number;
  private staticLayer = new Container();
  private dyn = new Container();
  private glow = new Container();
  private costLayer = new Container();
  private rulesSprite = new Sprite();
  private statsLayer = new Container();
  private back?: Container;
  private lastRules = '';
  private lastCost = '';
  private lastStats = '';
  private cacheQueued = false;
  faceDown = false;
  glowState: 'none' | 'playable' | 'response' | 'selected' | 'danger' = 'none';

  constructor(card: { id: string; up: boolean; uid?: number }, opts: { live?: CardLive } = {}) {
    super();
    this.cardId = card.id;
    this.up = card.up;
    this.cardUid = card.uid ?? -1;
    this.def = content().card(card.id, card.up);
    this.pivot.set(CARD_W / 2, CARD_H / 2);
    this.addChild(this.glow, this.staticLayer, this.dyn);
    this.dyn.addChild(this.rulesSprite, this.costLayer, this.statsLayer);
    this.buildStatic();
    this.update(opts.live ?? {});
  }

  private buildStatic() {
    const d = this.def;
    const f = d.faction;
    const L = this.staticLayer;
    L.addChild(uiCover('tex_paper', CARD_W, CARD_H, 12));
    // art window: placeholder pattern until the card art has loaded
    const artHolder = new Container();
    const mask = maskPoly(artWindow(d.type));
    const ph = uiCover('art_placeholder', CARD_W, CARD_H);
    ph.mask = mask;
    artHolder.addChild(mask, ph);
    L.addChild(artHolder);
    assets.with(K.card(f, d.id), (t) => {
      const s = new Sprite(t);
      const k = Math.max(ART.w / t.width, ART.h / t.height);
      s.scale.set(k);
      s.position.set(ART.x + (ART.w - t.width * k) / 2, ART.y + (ART.h - t.height * k) * 0.35);
      s.mask = mask;
      artHolder.addChild(s);
      ph.visible = false;
      this.queueCache();
    });
    L.addChild(nine(`card_frame_${f}`, CARD_W, CARD_H));
    const ribbon = nine(`ribbon_${f}`, CARD_W + 16, 54);
    ribbon.position.set(-8, RIBBON_Y);
    L.addChild(ribbon);
    const nameText = new Text({
      text: d.name + (this.up && !d.name.endsWith('+') ? '+' : ''),
      style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: d.name.length > 6 ? 21 : 25, fill: this.up ? 0xc8ffb0 : WB.white, stroke: { color: WB.ink, width: 5 }, letterSpacing: 2 },
    });
    nameText.anchor.set(0.5);
    nameText.position.set(CARD_W / 2, RIBBON_Y + 27);
    if (nameText.width > CARD_W - 90) nameText.scale.set((CARD_W - 90) / nameText.width);
    L.addChild(nameText);
    if (!['basic', 'token', 'special'].includes(d.rarity)) {
      // rarity gem rides on the ribbon's right scroll end, leaving the rules area free
      const g = gem(d.rarity, 24);
      g.position.set(CARD_W - 30, RIBBON_Y + 27);
      L.addChild(g);
    }
    if (d.type === 'response' || (d.keywords ?? []).includes('response')) {
      const seal = new Container();
      seal.addChild(uiSprite('seal_response', 50, 50));
      const st = new Text({ text: '应', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 28, fill: WB.white, stroke: { color: WB.vermilionDk, width: 3 } } });
      st.anchor.set(0.5);
      seal.addChild(st);
      seal.position.set(CARD_W - 40, 44);
      seal.rotation = 0.08;
      L.addChild(seal);
    }
    if (d.rarity === 'legendary') L.addChildAt(frame('gold', CARD_W, CARD_H, 8), 0);
    for (const key of [K.ui(`card_frame_${f}`), K.ui(`ribbon_${f}`), K.ui('tex_paper')]) assets.with(key, () => this.queueCache());
    this.queueCache();
  }

  private queueCache() {
    if (this.cacheQueued) return;
    this.cacheQueued = true;
    requestAnimationFrame(() => {
      this.cacheQueued = false;
      if (this.destroyed) return;
      try { this.staticLayer.cacheAsTexture(false); this.staticLayer.cacheAsTexture({ resolution: 2 } as never); } catch { /* ignore */ }
    });
  }

  update(live: CardLive) {
    const d = this.def;
    const cost = live.cost ?? { g: d.cost.g === 'X' ? 0 : d.cost.g, c: d.cost.c ?? [], x: d.cost.g === 'X' };
    const baseG = d.cost.g === 'X' ? 0 : d.cost.g;
    const costKey = JSON.stringify([cost, live.payable, live.missing]);
    if (costKey !== this.lastCost) {
      this.lastCost = costKey;
      this.costLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      const disc = uiSprite('cost_disc', 72, 72, live.payable === false ? { tint: 0xa89a90 } : {});
      disc.position.set(40, 40);
      this.costLayer.addChild(disc);
      // the disc shows the TOTAL sources needed (generic + colored); colored ones are also shown as pips below
      const total = cost.g + cost.c.length, baseTotal = baseG + (d.cost.c ?? []).length;
      const numCol = total < baseTotal ? 0x9aff8a : total > baseTotal ? 0xff8a6a : live.payable === false ? 0xc8b8a8 : WB.white;
      const n = new Text({ text: cost.x ? (cost.c.length ? `X+${cost.c.length}` : 'X') : String(total), style: { fontFamily: FONT_NUM, fontWeight: '900', fontSize: 34, fill: numCol, stroke: { color: WB.ink, width: 6 } } });
      n.anchor.set(0.5);
      n.position.set(40, 39);
      if (n.width > 56) n.scale.set(56 / n.width);
      this.costLayer.addChild(n);
      const missing = [...(live.missing ?? [])];
      cost.c.forEach((c, i) => {
        const mi = missing.indexOf(c);
        const empty = mi >= 0;
        if (empty) missing.splice(mi, 1);
        const p = pip(c, 32, empty);
        p.position.set(40, 94 + i * 32);
        this.costLayer.addChild(p);
      });
    }
    const vars: Record<string, VarInfo> = {};
    for (const [k, v] of Object.entries(d.vars ?? {})) vars[k] = live.vars?.[k] ?? { value: v, base: v };
    const rulesKey = JSON.stringify([d.text, vars]);
    if (rulesKey !== this.lastRules) {
      this.lastRules = rulesKey;
      const old = this.rulesSprite.texture;
      const { texture } = richTexture(d.text, { width: RULES.w, height: RULES.h, fontSize: 21, minFontSize: 15, color: 0x1e140c, vars, align: 'center', vAlign: 'middle', weight: '700', lineHeight: 1.35 });
      this.rulesSprite.texture = texture;
      this.rulesSprite.position.set(RULES.x, RULES.y);
      if (old && old !== Texture.EMPTY) old.destroy(true);
    }
    const statKey = JSON.stringify([live.atk, live.hp]);
    if (statKey !== this.lastStats) {
      this.lastStats = statKey;
      this.statsLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
      if (d.type === 'unit' && d.unit) {
        this.statsLayer.addChild(statBadge('atk', live.atk ?? d.unit.atk, d.unit.atk, 30, CARD_H - 28));
        this.statsLayer.addChild(statBadge('hp', live.hp ?? d.unit.hp, d.unit.hp, CARD_W - 30, CARD_H - 28));
      } else if (d.type === 'equip' && d.equip) {
        if (d.equip.atk !== undefined) this.statsLayer.addChild(statBadge('atk', d.equip.atk, d.equip.atk, 30, CARD_H - 28));
        if (d.equip.durability) this.statsLayer.addChild(statBadge('dur', d.equip.durability, d.equip.durability, CARD_W - 30, CARD_H - 28));
      } else if (d.type === 'delay' && d.delay) {
        this.statsLayer.addChild(statBadge('turns', d.delay.turns, d.delay.turns, CARD_W - 30, CARD_H - 28));
      } else if (d.type === 'field' && d.field?.duration) {
        this.statsLayer.addChild(statBadge('turns', d.field.duration, d.field.duration, CARD_W - 30, CARD_H - 28));
      }
    }
  }

  setGlow(state: CardView['glowState']) {
    if (state === this.glowState) return;
    this.glowState = state;
    this.glow.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (state === 'none') return;
    this.glow.addChild(frame(state === 'playable' ? 'gold' : state === 'selected' ? 'blue' : 'red', CARD_W, CARD_H, 12));
  }

  setFaceDown(down: boolean) {
    this.faceDown = down;
    if (down && !this.back) {
      this.back = uiFill('card_back', CARD_W, CARD_H);
      this.addChild(this.back);
    }
    if (this.back) this.back.visible = down;
    this.staticLayer.visible = !down;
    this.dyn.visible = !down;
  }

  get rulesTerms(): string[] {
    const out: string[] = [];
    for (const m of this.def.text.matchAll(/\[([^\]]+)\]/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
    return out;
  }
}

export function statBadge(kind: 'atk' | 'hp' | 'dur' | 'turns', value: number, base: number, x: number, y: number, size = 54): Container {
  const c = new Container();
  c.addChild(uiSprite(`stat_${kind}`, size, size));
  const col = value > base ? 0x9aff8a : value < base ? 0xff8a6a : WB.white;
  const t = new Text({ text: String(value), style: { fontFamily: FONT_NUM, fontWeight: '900', fontSize: Math.round(size * 0.48), fill: col, stroke: { color: WB.ink, width: 6 } } });
  t.anchor.set(0.5);
  t.y = 1;
  c.addChild(t);
  c.position.set(x, y);
  return c;
}

/** kept for callers that want the generated card-back texture directly */
export function cardBackTexture(): Texture {
  return assets.get(K.ui('card_back')) ?? Texture.EMPTY;
}

export { maskRect };

/**
 * The cost disc explained: it shows the TOTAL sources needed; the pips under it are the part that must be a given
 * color (横刀: disc 2 + one 赤 pip = 2 sources, one of them 赤 — not 3). With a live cost, changes are called out.
 */
export function costExplain(def: CardDef, live?: { g: number; c: Color[]; x: boolean }): { title: string; body: string } {
  const printedG = def.cost.g === 'X' ? 0 : def.cost.g;
  const cost = live ?? { g: printedG, c: def.cost.c ?? [], x: def.cost.g === 'X' };
  const colors = new Map<Color, number>();
  for (const col of cost.c) colors.set(col, (colors.get(col) ?? 0) + 1);
  const colored = [...colors.entries()].map(([col, n]) => `${n} 枚须为${COLOR_INFO[col].name}源`).join('、');
  if (cost.x) return { title: '费用', body: `X：打出时支付所有可用的源，X 等于支付的数量${colored ? `（其中 ${colored}）` : ''}。` };
  const total = cost.g + cost.c.length;
  const printed = printedG + (def.cost.c ?? []).length;
  const change = live && total !== printed ? `（原价 ${printed}，当前${total < printed ? '减少' : '增加'} ${Math.abs(total - printed)}）` : '';
  if (total === 0) return { title: '费用', body: `不消耗源。${change}` };
  return { title: '费用', body: `共需 ${total} 枚源${colored ? `，其中 ${colored}` : '，颜色不限'}。圆盘上的数字是总数，下方色标是其中须对应颜色的部分。${change}` };
}
