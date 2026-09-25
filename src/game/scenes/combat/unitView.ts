/** Unit / commander views on the battle line (UI研究笔记 §4.3, §8.3). */
import { Container, Sprite, Text } from 'pixi.js';
import type { Unit, CombatState } from '../../../engine/combat/state';
import { atkOf, maxHpOf, keywordsOf, canAttack } from '../../../engine/combat/board';
import { intentPreview } from '../../../engine/combat/intents';
import { content } from '../../../engine/content';
import { KEYWORDS, STATUSES } from '../../../engine/glossary';
import type { Keyword, StatusId } from '../../../engine/defs';
import { assets, K } from '../../assets';
import { FONT_NUM, FONT_TITLE } from '../../ui/theme';
import { iconSprite } from '../../ui/draw';
import { WB, Bar, uiSprite, uiCover, nine, frame, tag, icon, maskPoly } from '../../ui/skin';
import { statBadge } from '../../ui/card';
import { tweens, ease } from '../../core/tween';
import { TOKEN_W, TOKEN_H } from './layout';

type Mode = 'token' | 'figure' | 'commander' | 'boss';

export class UnitView extends Container {
  readonly unitUid: number;
  readonly mode: Mode;
  readonly body = new Container();
  private bodySprite: Sprite | null = null;
  private frame = new Container();
  private base = new Container();
  private hpBar!: Bar;
  private hpText: Text;
  private atkBadge = new Container();
  private hpBadge = new Container();
  private armorBadge = new Container();
  private wardFx = new Container();
  private statusCol = new Container();
  private kwStrip = new Container();
  private delayRow = new Container();
  readonly intentBox = new Container();
  readonly incoming = new Container();
  private readyLine = new Container();
  private highlight = new Container();
  private stealthFx = new Container();
  private frozenFx = new Container();
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
    const small0 = this.mode === 'token' || this.mode === 'figure';
    this.hpBar = new Bar(small0 ? this.bw - 6 : 224, small0 ? 16 : 24, 'red');
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
      const pts: number[] = [-w / 2, h / 2];
      for (let i = 0; i <= 12; i++) { const a = Math.PI + (Math.PI * i) / 12; pts.push(Math.cos(a) * (w / 2), -h / 2 + w / 2 + Math.sin(a) * (w / 2) * 0.62); }
      pts.push(w / 2, h / 2);
      const mask = maskPoly(pts);
      this.body.addChild(mask);
      const fb = uiCover('art_placeholder', w, h);
      fb.position.set(-w / 2, -h / 2);
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
      const fr = nine('token_frame', w + 14, h + 12);
      fr.position.set(-w / 2 - 7, -h / 2 - 6);
      this.frame.addChild(fr);
    } else {
      const isBoss = this.mode === 'boss';
      const key = u.origin === 'enemy' ? K.enemy(u.def, c.enemies.get(u.def)?.tier === 'boss') : K.hero(u.def);
      const targetH = this.mode === 'figure' ? 185 : isBoss ? 330 : 300;
      // placeholder until the figure art exists: a framed print block, bottom-anchored like the art
      const ph = new Container();
      const pw = this.mode === 'figure' ? 140 : 200, phh = this.mode === 'figure' ? 170 : 260;
      const phArt = uiCover('art_placeholder', pw - 20, phh - 20);
      phArt.position.set(-pw / 2 + 10, -phh + 10);
      const phFrame = nine('token_frame', pw, phh);
      phFrame.position.set(-pw / 2, -phh);
      const phName = new Text({ text: u.origin === 'enemy' ? (c.enemies.get(u.def)?.name ?? '') : (c.commanders.get(u.def)?.name ?? c.lieutenants.get(u.def)?.name ?? ''), style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 26, fill: WB.white, stroke: { color: WB.ink, width: 5 } } });
      phName.anchor.set(0.5);
      phName.position.set(0, -phh / 2);
      ph.addChild(phArt, phFrame, phName);
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
    if (!this.readyLine.children.length) {
      const rr = uiSprite('ring_gold', this.bw * 1.1, this.bw * 1.1);
      rr.scale.y = 0.28;
      rr.y = this.bottomY + (this.mode === 'token' ? 6 : 0);
      this.readyLine.addChild(rr);
    }
    this.readyLine.visible = ready;
    const dim = u.side === 'player' && u.kind === 'unit' && s.active === 'player' && !ready;
    if (this.bodySprite) this.bodySprite.tint = dim ? 0xa8a8a8 : 0xffffff;
    const hBody = this.bottomY - this.topY;
    if (!this.stealthFx.children.length) {
      const sm = uiSprite('smoke_overlay', this.bw * 1.2, hBody * 1.1, { alpha: 0.8 });
      sm.y = this.topY + hBody / 2;
      this.stealthFx.addChild(sm);
    }
    this.stealthFx.visible = u.stealth;
    if (!this.frozenFx.children.length) {
      const fz = uiSprite('frost_overlay', this.bw * 1.1, hBody * 1.05, { stretch: true });
      fz.y = this.topY + hBody / 2;
      this.frozenFx.addChild(fz);
    }
    this.frozenFx.visible = (u.statuses.freeze ?? 0) > 0;
    if (u.side === 'enemy' && u.origin === 'enemy') this.setIntent(s, u);
    this.alpha = u.dead ? 0.4 : 1;
  }

  setNumbers(hp: number, max: number, atk: number, armor: number, u?: Unit) {
    this.shown = { hp, maxHp: max, atk, armor };
    const small = this.mode === 'token' || this.mode === 'figure';
    const bw = small ? this.bw - 10 : 220;
    this.hpBar.set(hp / Math.max(1, max));
    this.hpBar.position.set(-this.hpBar.bw / 2, this.bottomY + (this.mode === 'token' ? 14 : 10));
    void bw;
    this.hpText.text = small ? '' : `${hp}/${max}`;
    this.hpText.anchor.set(0.5);
    this.hpText.position.set(0, this.hpBar.y + 12);
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
      const g = icon('ui_armor', 36);
      const t = new Text({ text: String(armor), style: { fontFamily: FONT_NUM, fontSize: 17, fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0, width: 4 } } });
      t.anchor.set(0.5);
      this.armorBadge.addChild(g, t);
      this.armorBadge.position.set(small ? 0 : -bw / 2 - 16, small ? this.bottomY - 6 : this.hpBar.y + 11);
    }
  }

  setWard(n: number) {
    if (!this.wardFx.children.length) {
      const hB = this.bottomY - this.topY;
      const wd = uiSprite('ward_bubble', this.bw * 1.35, hB * 1.25, { alpha: 0.9 });
      wd.y = this.topY + hB / 2;
      this.wardFx.addChild(wd);
    }
    this.wardFx.visible = n > 0;
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
      const g = tag('gold', 50, 28);
      g.position.set(-25, -14);
      const t = new Text({ text: String(d.turns), style: { fontFamily: FONT_NUM, fontSize: 17, fill: WB.ink, fontWeight: '900' } });
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
    const g = tag('red', 96, 34);
    g.position.set(-48, -17);
    const t = new Text({ text: `-${total}${count > 1 ? ` (${count})` : ''}`, style: { fontFamily: FONT_NUM, fontSize: 19, fontWeight: '900', fill: WB.white, stroke: { color: WB.ink, width: 3 } } });
    t.anchor.set(0.5);
    this.incoming.addChild(g, t);
    this.incoming.position.set(0, this.topY - (this.mode === 'token' ? 26 : 30));
  }

  setHighlight(state: UnitView['hlState']) {
    if (state === this.hlState) return;
    this.hlState = state;
    this.highlight.removeChildren().forEach((c) => c.destroy({ children: true }));
    if (state === 'none') return;
    const w = this.bw + 16, top = this.topY - 8, h = this.bottomY - this.topY + 16;
    const fr = frame(state === 'target' ? 'gold' : state === 'ready' ? 'blue' : 'red', w, h, 4);
    fr.position.set(-w / 2 - 4, top - 4);
    this.highlight.addChild(fr);
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
