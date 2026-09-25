/** Unit / commander views on the battle line (UI研究笔记 §4.3, §8.3). */
import { Container, Graphics, Sprite, Text } from 'pixi.js';
import type { Unit, CombatState } from '../../../engine/combat/state';
import { atkOf, maxHpOf, keywordsOf, canAttack } from '../../../engine/combat/board';
import { intentPreview } from '../../../engine/combat/intents';
import { content } from '../../../engine/content';
import { KEYWORDS, STATUSES } from '../../../engine/glossary';
import type { Keyword, StatusId } from '../../../engine/defs';
import { assets, K } from '../../assets';
import { C, FONT_NUM, FONT_TITLE, factionColor } from '../../ui/theme';
import { drawBar, iconSprite, lighten } from '../../ui/draw';
import { WB, printShape } from '../../ui/skin';
import { statBadge } from '../../ui/card';
import { fallbackArt } from '../../ui/card';
import { tweens, ease } from '../../core/tween';
import { TOKEN_W, TOKEN_H } from './layout';

type Mode = 'token' | 'figure' | 'commander' | 'boss';

export class UnitView extends Container {
  readonly unitUid: number;
  readonly mode: Mode;
  readonly body = new Container();
  private bodySprite: Sprite | null = null;
  private frame = new Graphics();
  private base = new Graphics();
  private hpBar = new Graphics();
  private hpText: Text;
  private atkBadge = new Container();
  private hpBadge = new Container();
  private armorBadge = new Container();
  private wardFx = new Graphics();
  private statusCol = new Container();
  private kwStrip = new Container();
  private delayRow = new Container();
  readonly intentBox = new Container();
  readonly incoming = new Container();
  private readyLine = new Graphics();
  private highlight = new Graphics();
  private stealthFx = new Graphics();
  private frozenFx = new Graphics();
  readonly bw: number;
  readonly bh: number;
  shown = { hp: 0, maxHp: 0, atk: 0, armor: 0 };
  private breathT = Math.random() * 3000;
  private hlState: 'none' | 'target' | 'hover' | 'danger' | 'ready' = 'none';

  constructor(u: Unit) {
    super();
    this.unitUid = u.uid;
    this.mode = u.kind === 'commander' ? (u.side === 'player' ? 'commander' : 'boss') : u.side === 'enemy' && u.origin === 'enemy' ? 'figure' : 'token';
    this.bw = this.mode === 'token' ? TOKEN_W : this.mode === 'figure' ? 150 : 230;
    this.bh = this.mode === 'token' ? TOKEN_H : this.mode === 'figure' ? 150 : 290;
    this.hpText = new Text({ text: '', style: { fontFamily: FONT_NUM, fontSize: this.mode === 'token' || this.mode === 'figure' ? 24 : 20, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x000000, width: 5 } } });
    this.addChild(this.highlight, this.base, this.body, this.frame, this.readyLine, this.stealthFx, this.frozenFx, this.wardFx, this.hpBar, this.hpText, this.atkBadge, this.hpBadge, this.armorBadge, this.statusCol, this.kwStrip, this.delayRow, this.incoming, this.intentBox);
    this.buildBody(u);
    this.eventMode = 'static';
    this.cursor = 'pointer';
  }

  private buildBody(u: Unit) {
    const c = content();
    if (this.mode === 'token') {
      const def = c.cards.has(u.def) ? c.card(u.def, u.up) : null;
      const f = def?.faction ?? 'N';
      const w = TOKEN_W, h = TOKEN_H;
      const mask = new Graphics().moveTo(-w / 2, h / 2).lineTo(-w / 2, -h / 2 + 34).quadraticCurveTo(-w / 2, -h / 2, -w / 2 + 34, -h / 2).lineTo(w / 2 - 34, -h / 2).quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + 34).lineTo(w / 2, h / 2).closePath().fill(0xffffff);
      this.body.addChild(mask);
      const fb = new Sprite(fallbackArt(f, def?.name ?? '灵'));
      fb.anchor.set(0.5);
      fb.width = w * 1.4; fb.height = h * 1.05;
      fb.mask = mask;
      this.body.addChild(fb);
      assets.with(K.card(f, u.def), (t) => {
        const s = new Sprite(t);
        s.anchor.set(0.5, 0.42);
        s.scale.set((h * 1.25) / t.height);
        s.mask = mask;
        this.body.addChild(s);
        fb.visible = false;
        this.bodySprite = s;
      });
      const fc = factionColor(f);
      this.frame.moveTo(-w / 2, h / 2).lineTo(-w / 2, -h / 2 + 34).quadraticCurveTo(-w / 2, -h / 2, -w / 2 + 34, -h / 2).lineTo(w / 2 - 34, -h / 2).quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + 34).lineTo(w / 2, h / 2).closePath().stroke({ width: 5, color: WB.ink });
      this.base.ellipse(0, h / 2 + 6, w * 0.55, 14).fill({ color: 0x000000, alpha: 0.45 });
    } else {
      const isBoss = this.mode === 'boss';
      const key = u.origin === 'enemy' ? K.enemy(u.def, c.enemies.get(u.def)?.tier === 'boss') : K.hero(u.def);
      const targetH = this.mode === 'figure' ? 185 : isBoss ? 330 : 300;
      this.base.ellipse(0, 0, this.mode === 'figure' ? 62 : 110, this.mode === 'figure' ? 16 : 24).fill({ color: 0x000000, alpha: 0.5 });
      const ph = new Graphics();
      ph.roundRect(-50, -targetH, 100, targetH, 30).fill({ color: 0x2a1f19, alpha: 0.6 });
      this.body.addChild(ph);
      assets.with(key, (t) => {
        const s = new Sprite(t);
        s.anchor.set(0.5, 1);
        const k = Math.min(targetH / t.height, (this.mode === 'figure' ? 190 : 300) / t.width);
        s.scale.set(k);
        if (u.side === 'player') s.scale.x = -Math.abs(s.scale.x) * 0 + Math.abs(s.scale.x); // commanders face right already
        if (u.side === 'enemy' && this.mode === 'figure') s.scale.x = -Math.abs(s.scale.x); // enemies face left
        this.body.addChild(s);
        ph.visible = false;
        this.bodySprite = s;
      });
      if (this.mode !== 'figure') this.body.y = 120; else this.body.y = 60;
      this.base.y = this.body.y;
    }
  }

  /** top-left/bottom geometry helpers for attached UI */
  get topY() { return this.mode === 'token' ? -TOKEN_H / 2 : this.mode === 'figure' ? -130 : -190; }
  get bottomY() { return this.mode === 'token' ? TOKEN_H / 2 : this.mode === 'figure' ? 60 : 120; }

  sync(s: CombatState, u: Unit) {
    const atk = atkOf(s, u), max = maxHpOf(s, u);
    this.setNumbers(u.hp, max, atk, u.armor, u);
    this.setWard(u.ward);
    this.setStatuses(u.statuses);
    this.setKeywords(keywordsOf(s, u).filter((k) => k !== 'ward'));
    this.setDelays(u.delays.map((d) => ({ card: d.card, turns: d.turns })));
    const ready = u.side === 'player' && s.phase === 'main' && canAttack(s, u);
    this.readyLine.clear();
    if (ready) this.readyLine.ellipse(0, this.bottomY + (this.mode === 'token' ? 6 : 0), this.bw * 0.5, 12).stroke({ width: 3, color: 0xffd46a, alpha: 0.9 });
    const dim = u.side === 'player' && u.kind === 'unit' && s.active === 'player' && !ready;
    if (this.bodySprite) this.bodySprite.tint = dim ? 0xa8a8a8 : 0xffffff;
    this.stealthFx.clear();
    if (u.stealth) this.stealthFx.roundRect(-this.bw / 2, this.topY, this.bw, this.bottomY - this.topY, 16).fill({ color: 0x101428, alpha: 0.45 });
    this.frozenFx.clear();
    if ((u.statuses.freeze ?? 0) > 0) this.frozenFx.roundRect(-this.bw / 2 + 4, this.topY + 4, this.bw - 8, this.bottomY - this.topY - 8, 14).fill({ color: 0x9ad8ff, alpha: 0.28 }).stroke({ width: 3, color: 0xc8f0ff, alpha: 0.9 });
    if (u.side === 'enemy' && u.origin === 'enemy') this.setIntent(s, u);
    this.alpha = u.dead ? 0.4 : 1;
  }

  setNumbers(hp: number, max: number, atk: number, armor: number, u?: Unit) {
    this.shown = { hp, maxHp: max, atk, armor };
    const small = this.mode === 'token' || this.mode === 'figure';
    const bw = small ? this.bw - 10 : 220;
    drawBar(this.hpBar, bw, small ? 14 : 22, hp / Math.max(1, max), C.hp);
    this.hpBar.position.set(-bw / 2, this.bottomY + (this.mode === 'token' ? 14 : 10));
    this.hpText.text = small ? '' : `${hp}/${max}`;
    this.hpText.anchor.set(0.5);
    this.hpText.position.set(0, this.hpBar.y + 11);
    // badges
    this.atkBadge.removeChildren(); this.hpBadge.removeChildren(); this.armorBadge.removeChildren();
    if (small) {
      const baseAtk = u ? u.baseAtk : atk;
      this.atkBadge.addChild(badge('atk', atk, atk > baseAtk ? 0x8aff9a : atk < baseAtk ? 0xff8a7a : 0xffffff));
      this.atkBadge.position.set(-this.bw / 2 + 4, this.bottomY - 6);
      this.hpBadge.addChild(badge('hp', hp, hp < max ? 0xff8a7a : u && max > u.baseMaxHp ? 0x8aff9a : 0xffffff));
      this.hpBadge.position.set(this.bw / 2 - 4, this.bottomY - 6);
    } else if (atk > 0 && this.mode === 'commander') {
      this.atkBadge.addChild(badge('atk', atk, 0xffffff));
      this.atkBadge.position.set(-128, this.hpBar.y + 11);
    }
    if (armor > 0) {
      const g = printShape(new Graphics(), (gg, dx, dy) => gg.poly([dx, -16 + dy, 15 + dx, -9 + dy, 15 + dx, 7 + dy, dx, 16 + dy, -15 + dx, 7 + dy, -15 + dx, -9 + dy]), WB.azurite, { offset: 2.5 });
      const t = new Text({ text: String(armor), style: { fontFamily: FONT_NUM, fontSize: 17, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0, width: 4 } } });
      t.anchor.set(0.5);
      this.armorBadge.addChild(g, t);
      this.armorBadge.position.set(small ? 0 : -bw / 2 - 16, small ? this.bottomY - 6 : this.hpBar.y + 11);
    }
  }

  setWard(n: number) {
    this.wardFx.clear();
    if (n <= 0) return;
    const r = this.mode === 'token' ? 78 : this.mode === 'figure' ? 95 : 150;
    const cy = this.mode === 'token' ? 0 : this.mode === 'figure' ? -40 : -40;
    this.wardFx.ellipse(0, cy, r * 0.8, r).fill({ color: 0xffe8a0, alpha: 0.12 }).stroke({ width: 3, color: 0xffe8a0, alpha: 0.7 });
  }

  setStatuses(st: Partial<Record<StatusId, number>>) {
    this.statusCol.removeChildren();
    const list = Object.entries(st).filter(([, v]) => (v ?? 0) !== 0) as [StatusId, number][];
    list.slice(0, 5).forEach(([id, v], i) => {
      const info = STATUSES[id];
      const c = new Container();
      const ic = iconSprite(info.icon, 30, info.name[0]!, info.tint);
      c.addChild(ic);
      if (id !== 'stun' && id !== 'silence') {
        const t = new Text({ text: String(v), style: { fontFamily: FONT_NUM, fontSize: 16, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0, width: 4 } } });
        t.anchor.set(0.5); t.position.set(10, 10);
        c.addChild(t);
      }
      c.position.set(0, i * 32);
      (c as Container & { statusId?: string }).statusId = id;
      this.statusCol.addChild(c);
    });
    const small = this.mode === 'token' || this.mode === 'figure';
    this.statusCol.position.set(small ? this.bw / 2 + 12 : 130, small ? this.topY + 16 : -120);
  }

  setKeywords(kws: Keyword[]) {
    this.kwStrip.removeChildren();
    kws.slice(0, 4).forEach((k, i) => {
      const info = KEYWORDS[k];
      const ic = iconSprite(info.icon, 26, info.name[0]!, info.tint);
      ic.position.set(i * 27, 0);
      this.kwStrip.addChild(ic);
    });
    this.kwStrip.position.set(-(Math.min(4, kws.length) - 1) * 13.5, this.topY - 4);
  }

  setDelays(ds: { card: string; turns: number }[]) {
    this.delayRow.removeChildren();
    ds.forEach((d, i) => {
      const c = new Container();
      const g = new Graphics().roundRect(-22, -12, 44, 24, 6).fill({ color: 0x3a2a0a, alpha: 0.9 }).stroke({ width: 1.5, color: 0xf0d27a });
      const t = new Text({ text: `⌛${d.turns}`, style: { fontFamily: FONT_NUM, fontSize: 15, fill: 0xffe8a0, fontWeight: 'bold' } });
      t.anchor.set(0.5);
      c.addChild(g, t);
      c.position.set((i - (ds.length - 1) / 2) * 48, this.bottomY + (this.mode === 'token' ? 44 : 40));
      (c as Container & { delayCard?: string }).delayCard = d.card;
      this.delayRow.addChild(c);
    });
  }

  setIntent(s: CombatState, u: Unit) {
    this.intentBox.removeChildren();
    const pv = intentPreview(s, u);
    if (!pv) return;
    const types = pv.types.slice(0, 3);
    types.forEach((t, i) => {
      let icon = `in_${t}`;
      let glyph = { attack: '攻', defend: '守', buff: '增', debuff: '损', summon: '召', judge: '判', cast: '术', unknown: '？', escape: '逃', sleep: '眠', heal: '愈' }[t];
      if (t === 'attack') {
        const d = pv.damage ?? 0;
        icon = `in_attack${d < 5 ? 1 : d < 10 ? 2 : d < 20 ? 3 : d < 40 ? 4 : 5}`;
        glyph = '攻';
      }
      const c = new Container();
      const ic = iconSprite(icon, 54, glyph ?? '？', t === 'attack' ? 0xff6a4a : t === 'defend' ? 0x7fa6d6 : t === 'buff' ? 0xf0c050 : t === 'debuff' ? 0xb07ae0 : 0xd8c8b0);
      c.addChild(ic);
      let num = '';
      if (t === 'attack' && pv.damage !== undefined) num = (pv.hits ?? 1) > 1 ? `${pv.damage}×${pv.hits}` : String(pv.damage);
      if (t === 'defend' && pv.armor) num = String(pv.armor);
      if (t === 'summon' && pv.summons) num = String(pv.summons);
      if (t === 'cast') num = String(s.sides.enemy.hand.length || '');
      if (num) {
        const tx = new Text({ text: num, style: { fontFamily: FONT_NUM, fontSize: 24, fontWeight: 'bold', fill: t === 'attack' ? 0xffe0d0 : 0xffffff, stroke: { color: 0x000000, width: 5 } } });
        tx.anchor.set(0.5, 0);
        tx.position.set(0, 16);
        c.addChild(tx);
      }
      c.position.set(i * 58, 0);
      this.intentBox.addChild(c);
    });
    const w = types.length * 58;
    if (this.mode === 'boss') this.intentBox.position.set(-w / 2 + 29, -250);
    else this.intentBox.position.set(-w / 2 + 29 - (this.mode === 'figure' ? 40 : 0), this.topY - 40);
    (this.intentBox as Container & { preview?: typeof pv }).preview = pv;
  }

  setIncoming(total: number, count: number) {
    this.incoming.removeChildren();
    if (total <= 0) return;
    const g = new Graphics().roundRect(-40, -16, 80, 32, 8).fill({ color: 0x8a1a10, alpha: 0.9 }).stroke({ width: 2, color: 0xffb0a0 });
    const t = new Text({ text: `⚔${total}${count > 1 ? ` (${count})` : ''}`, style: { fontFamily: FONT_NUM, fontSize: 18, fontWeight: 'bold', fill: 0xffffff } });
    t.anchor.set(0.5);
    this.incoming.addChild(g, t);
    this.incoming.position.set(0, this.topY - (this.mode === 'token' ? 26 : 30));
  }

  setHighlight(state: UnitView['hlState']) {
    if (state === this.hlState) return;
    this.hlState = state;
    const g = this.highlight;
    g.clear();
    if (state === 'none') return;
    const col = state === 'target' ? WB.ochre : state === 'hover' ? WB.vermilion : state === 'danger' ? 0xe02a1a : 0x6ac8e0;
    const w = this.bw + 16, top = this.topY - 8, h = this.bottomY - this.topY + 16;
    g.roundRect(-w / 2, top, w, h, 14).stroke({ width: 8, color: WB.ink });
    g.roundRect(-w / 2, top, w, h, 14).stroke({ width: 4.5, color: col });
  }

  /** local hit test rect (for drop targets) */
  hitRect() {
    return { x: this.x - this.bw / 2 - 10, y: this.y + this.topY - 10, w: this.bw + 20, h: this.bottomY - this.topY + 20 };
  }

  flash() {
    const s = this.bodySprite;
    if (!s) return;
    s.tint = 0xffffff;
    const f = { v: 1 };
    const orig = s.blendMode;
    s.blendMode = 'add';
    void tweens.to(f, { v: 0 }, 160, { onUpdate: () => { s.alpha = 1; } }).then(() => { s.blendMode = orig; });
  }

  async lunge(tx: number, ty: number) {
    const ox = this.x, oy = this.y;
    const dx = tx - ox, dy = ty - oy;
    const d = Math.hypot(dx, dy);
    const k = Math.max(0, (d - 90) / d);
    await tweens.to(this, { x: ox - dx * 0.06, y: oy - dy * 0.06 }, 110, { ease: ease.outQuad });
    await tweens.to(this, { x: ox + dx * k, y: oy + dy * k }, 150, { ease: ease.inCubic });
  }

  async returnTo(x: number, y: number) {
    await tweens.to(this, { x, y }, 220, { ease: ease.outCubic });
  }

  async hitReact(dir = 1) {
    const ox = this.x;
    this.flash();
    await tweens.run(180, (k) => { this.x = ox + Math.sin(k * Math.PI * 4) * 8 * (1 - k) * dir; });
    this.x = ox;
  }

  tick(dt: number) {
    this.breathT += dt;
    if (this.mode !== 'token' && this.bodySprite) {
      const k = Math.sin(this.breathT / (this.mode === 'boss' ? 1100 : 900)) * 0.012;
      this.bodySprite.scale.y = Math.abs(this.bodySprite.scale.x) * (1 + k);
    }
  }
}

function badge(kind: 'atk' | 'hp', v: number, col: number): Container {
  const c = statBadge(kind, v, v, 0, 0, 40);
  const t = c.children[c.children.length - 1] as Text;
  t.style.fill = col;
  return c;
}

export { FONT_TITLE };
