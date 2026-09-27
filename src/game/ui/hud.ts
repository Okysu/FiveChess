/** Run HUD: top bar, relic bar, deck/pile viewers, card inspector, card picker. */
import { Container, Sprite, Text } from 'pixi.js';
import { COLOR_INFO } from '../../engine/glossary';
import { G } from '../core/app';
import { fs } from './profile';
import { content } from '../../engine/content';
import type { CardRef, RunState } from '../../engine/run/run';
import { Box } from '../core/layout';
import { C, FONT_NUM, FONT_TITLE, FONT_UI, FONT_BODY, TYPE_NAME } from './theme';
import { iconSprite } from './draw';
import { Bar, nine, uiSprite, maskCircle, icon, INSET } from './skin';
import { Button, Modal, Tooltip, glossLines, hideTip, label, showTip, toast } from './widgets';
import { CardView, CARD_W, CARD_H, costExplain } from './card';
import { ScrollBox } from './scroll';
import { assets, K } from '../assets';
import { tweens, ease } from '../core/tween';
import { sfx } from '../audio/audio';
import { richTexture } from './richtext';
import { session } from '../state';

const ACT_NAMES: Record<number, string> = { 1: '残碑林', 2: '沉渊城', 3: '星殿', 4: '命书之心' };
export const actName = (a: number) => ACT_NAMES[a] ?? '';
const NUM_CN = ['零', '一', '二', '三', '四'];

export interface TopBarHooks {
  onPotion?: (slot: number) => void;
  onDeck?: () => void;
  onMap?: () => void;
  onSettings?: () => void;
  onCodex?: () => void;
  hp?: () => { hp: number; max: number; armor: number };
  potions?: () => (string | null)[];
}

export class TopBar extends Container {
  private hpBar = new Bar(220, 24, 'red');
  private hpText: Text;
  private goldText: Text;
  private potionBox = new Container();
  private deckBtn: Button;
  private relicBar = new Container();
  private armorBadge = new Container();

  private bg = new Container();
  private row!: Box;
  private offView?: () => void;

  constructor(private run: RunState, private hooks: TopBarHooks = {}) {
    super();
    this.addChild(this.bg);

    const row = new Box({ dir: 'row', align: 'center', gap: 18, padding: [0, 16], width: 1920, height: 80 });
    this.row = row;
    // portrait
    const cmd = content().commander(run.commander);
    const portrait = new Container();
    const pm = maskCircle(32, 32, 29);
    const ringS = uiSprite('skill_disc', 70, 70);
    ringS.position.set(32, 32);
    portrait.addChild(ringS);
    assets.with(K.hero(cmd.id), (t) => {
      const s = new Sprite(t);
      const k = 64 / (t.width * 0.55);
      s.scale.set(k);
      s.position.set(32 - (t.width * k) / 2, 32 - t.height * k * 0.12 - 8);
      portrait.addChild(pm);
      s.mask = pm;
      portrait.addChild(s);
    });
    row.add(portrait, { width: 64, height: 64 });
    if (run.lieutenant) {
      const lt = content().lieutenants.get(run.lieutenant);
      if (lt) {
        const lp = new Container();
        const lm = maskCircle(24, 24, 21);
        const lr = uiSprite('skill_disc', 52, 52, { tint: 0xc8f0d8 });
        lr.position.set(24, 24);
        lp.addChild(lr);
        assets.with(K.hero(lt.id), (t) => {
          const s = new Sprite(t);
          const k = 48 / (t.width * 0.55);
          s.scale.set(k);
          s.position.set(24 - (t.width * k) / 2, 24 - t.height * k * 0.12 - 6);
          lp.addChild(lm);
          s.mask = lm;
          lp.addChild(s);
        });
        lp.eventMode = 'static';
        lp.on('pointerover', () => showTip(new Tooltip([
          { title: `副将 · ${lt.name}「${lt.title}」`, body: `【${lt.skill.name}】${lt.skill.text}` },
          { title: '本局加成', body: `· 技能出现在战斗左侧的主帅技能旁\n· 开局 1 枚素源变为${COLOR_INFO[lt.faction].name}源\n· 奖励与商店卡池加入${COLOR_INFO[lt.faction].name}色牌\n· 仅限本局冒险，下一局需重新招贤` },
        ], 400), 0, 0));
        lp.on('pointerout', hideTip);
        row.add(lp, { width: 48, height: 48 });
      }
    }
    const hpCol = new Box({ dir: 'column', gap: 4 });
    const nm = new Text({ text: `${cmd.name} · ${cmd.title}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(22), fill: C.goldLight } });
    hpCol.add(nm);
    const hpWrap = new Container();
    hpWrap.addChild(this.hpBar);
    this.hpText = new Text({ text: '', style: { fontFamily: FONT_NUM, fontSize: fs(17), fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0x000000, width: 4 } } });
    this.hpText.anchor.set(0.5);
    this.hpText.position.set(110, 11);
    hpWrap.addChild(this.hpText, this.armorBadge);
    hpCol.add(hpWrap, { width: 220, height: 22 });
    row.add(hpCol);
    // gold
    const gold = new Container();
    const gi = iconSprite('ui_gold', 40, '金', C.gold);
    gi.position.set(20, 20);
    gold.addChild(gi);
    this.goldText = new Text({ text: '', style: { fontFamily: FONT_NUM, fontSize: fs(26), fontWeight: 'bold', fill: C.goldLight, stroke: { color: 0x000000, width: 4 } } });
    this.goldText.position.set(46, 4);
    gold.addChild(this.goldText);
    gold.eventMode = 'static';
    gold.on('pointerover', (e) => showTip(new Tooltip([{ title: '金币', body: '在商店购买卡牌、遗物、丹药与除牌服务。' }]), e.global.x / 1, 90));
    gold.on('pointerout', hideTip);
    row.add(gold, { width: 120, height: 40 });
    row.add(this.potionBox, { width: 3 * 72 + 24, height: 64 });
    // center info
    const info = new Text({
      text: `第${NUM_CN[run.act] ?? run.act}幕 · ${actName(run.act)} · 第${Math.max(1, run.floor)}层${run.ascension ? `   逆命 ${run.ascension}` : ''}`,
      style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(26), fill: C.text, letterSpacing: 2 },
    });
    const spacer = new Box({ grow: 1, align: 'center', justify: 'center', height: 80 });
    spacer.add(info);
    row.add(spacer);
    // buttons
    this.deckBtn = new Button(`牌组 ${run.deck.length}`, { width: 128, height: 56, fontSize: fs(22), kind: 'ghost', onClick: () => (hooks.onDeck ?? (() => openDeck(run.deck, '牌组')))() });
    row.add(this.deckBtn, { width: 128, height: 56 });
    if (hooks.onMap) row.add(new Button('地图', { width: 100, height: 56, fontSize: fs(22), kind: 'ghost', onClick: hooks.onMap }), { width: 100, height: 56 });
    row.add(new Button('图鉴', { width: 100, height: 56, fontSize: fs(22), kind: 'ghost', onClick: hooks.onCodex ?? (() => session.router?.call(null)) }), { width: 100, height: 56 });
    row.add(new Button('设置', { width: 100, height: 56, fontSize: fs(22), kind: 'ghost', onClick: hooks.onSettings }), { width: 100, height: 56 });
    this.addChild(row);
    this.relicBar.position.set(16, 100);
    this.addChild(this.relicBar);
    this.refresh();
    // pinned to the top edge and as wide as the visible screen (windows that aren't 16:9 have no dead band above it)
    this.fit();
    this.offView = G.onView(() => this.fit());
    this.on('destroyed', () => this.offView?.());
  }

  /** stick to the top-left of the visible screen and span its width */
  fit() {
    // band spans the whole screen width; its contents and vertical position respect the HUD safe area
    const v = G.view, h = G.hud;
    this.position.set(v.left, h.top);
    const w = Math.round(v.width);
    this.bg.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.bg.addChild(nine('topbar', w, 96));
    const inL = h.left - v.left, inR = v.right - h.right;
    this.row.position.set(inL, 0);
    const rw = Math.round(w - inL - inR);
    this.row.node.setWidth(rw);
    this.row.layout(rw, 80);
    this.relicBar.position.set(inL + 16, 100);
  }

  refresh() {
    const r = this.run;
    const live = this.hooks.hp?.();
    const hp = live?.hp ?? r.hp, max = live?.max ?? r.maxHp, armor = live?.armor ?? 0;
    this.hpBar.set(hp / max);
    this.hpText.text = `${hp}/${max}`;
    this.armorBadge.removeChildren();
    if (armor > 0) {
      const b = icon('ui_armor', 30);
      const t = new Text({ text: String(armor), style: { fontFamily: FONT_NUM, fontSize: fs(15), fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0, width: 3 } } });
      t.anchor.set(0.5);
      b.position.set(-4, 11); t.position.set(-4, 11);
      this.armorBadge.addChild(b, t);
    }
    this.goldText.text = String(r.gold);
    this.deckBtn.setText(`牌组 ${r.deck.length}`);
    // potions
    this.potionBox.removeChildren();
    const pots = this.hooks.potions?.() ?? r.potions;
    pots.forEach((id, i) => {
      const slot = new Container();
      slot.position.set(i * 80, 0);
      const g = nine('equip_slot', 70, 64, id ? {} : { alpha: 0.55 });
      slot.addChild(g);
      if (id) {
        const def = content().potions.get(id);
        const ic = new Container();
        const fb = iconSprite('ui_potion', 50, '丹', C.jade);
        fb.position.set(35, 32);
        ic.addChild(fb);
        assets.with(K.potion(id), (t) => { const s = new Sprite(t); s.anchor.set(0.5); s.scale.set(54 / Math.max(t.width, t.height)); s.position.set(35, 32); ic.removeChildren(); ic.addChild(s); });
        slot.addChild(ic);
        slot.eventMode = 'static';
        slot.cursor = 'pointer';
        slot.on('pointerover', (e) => showTip(new Tooltip([{ title: def?.name ?? id, body: def?.text ?? '' }, ...glossLines(termsOf(def?.text ?? ''))]), e.global.x, 90));
        slot.on('pointerout', hideTip);
        slot.on('pointertap', () => { hideTip(); this.hooks.onPotion?.(i); });
      }
      this.potionBox.addChild(slot);
    });
    // relics
    this.relicBar.removeChildren();
    r.relics.forEach((rs, i) => {
      const def = content().relics.get(rs.id);
      if (!def) return;
      const c = new Container();
      c.position.set(i * 46, 0);
      const bgc = uiSprite(def.tier === 'boss' ? 'skill_disc_active' : 'skill_disc', 44, 44);
      bgc.position.set(20, 20);
      c.addChild(bgc);
      const holder = new Container();
      const fb = iconSprite('ui_relic', 34, def.name[0] ?? '遗', C.gold);
      fb.position.set(20, 20);
      holder.addChild(fb);
      assets.with(K.relic(rs.id), (t) => { const s = new Sprite(t); s.anchor.set(0.5); s.scale.set(38 / Math.max(t.width, t.height)); s.position.set(20, 20); holder.removeChildren(); holder.addChild(s); });
      c.addChild(holder);
      if (rs.counter) {
        const ct = new Text({ text: String(rs.counter), style: { fontFamily: FONT_NUM, fontSize: fs(14), fontWeight: 'bold', fill: 0xffffff, stroke: { color: 0, width: 3 } } });
        ct.position.set(28, 24);
        c.addChild(ct);
      }
      c.eventMode = 'static';
      c.on('pointerover', (e) => showTip(new Tooltip([{ title: def.name, body: def.text, color: def.tier === 'boss' ? 0xff8a6a : C.goldLight }, ...(def.flavor ? [{ body: def.flavor, color: C.textDim }] : []), ...glossLines(termsOf(def.text))]), e.global.x, 140));
      c.on('pointerout', hideTip);
      this.relicBar.addChild(c);
    });
  }

  /** flash a relic icon when it triggers */
  pulseRelic(id: string) {
    const i = this.run.relics.findIndex((r) => r.id === id);
    const c = this.relicBar.children[i];
    if (!c) return;
    void (async () => { await tweens.to(c.scale, { x: 1.35, y: 1.35 }, 120); await tweens.to(c.scale, { x: 1, y: 1 }, 220); })();
  }
}

export function termsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\[([^\]]+)\]/g)) if (!out.includes(m[1]!)) out.push(m[1]!);
  return out;
}

// ───────────── deck / pile viewer ─────────────

const TYPE_ORDER = ['unit', 'tactic', 'response', 'equip', 'delay', 'field', 'status', 'curse'];

export function sortCards<T extends { id: string; up: boolean }>(cards: T[]): T[] {
  return [...cards].sort((a, b) => {
    const da = content().card(a.id, a.up), db = content().card(b.id, b.up);
    const ca = da.cost.g === 'X' ? 0 : da.cost.g + (da.cost.c?.length ?? 0), cb = db.cost.g === 'X' ? 0 : db.cost.g + (db.cost.c?.length ?? 0);
    return TYPE_ORDER.indexOf(da.type) - TYPE_ORDER.indexOf(db.type) || ca - cb || da.name.localeCompare(db.name);
  });
}

export function cardGrid(cards: { id: string; up: boolean; uid?: number }[], opts: { width: number; height: number; scale?: number; onPick?: (i: number, v: CardView) => void; onHover?: (i: number, v: CardView | null) => void }) {
  const sc = opts.scale ?? 0.5;
  const cw = CARD_W * sc, ch = CARD_H * sc;
  const gap = 18;
  const perRow = Math.max(1, Math.floor((opts.width - 20) / (cw + gap)));
  const box = new ScrollBox(opts.width, opts.height);
  const views: CardView[] = [];
  cards.forEach((c, i) => {
    const v = new CardView({ id: c.id, up: c.up, uid: c.uid });
    v.scale.set(sc);
    const col = i % perRow, row = Math.floor(i / perRow);
    const ox = (opts.width - perRow * (cw + gap) + gap) / 2;
    v.position.set(ox + col * (cw + gap) + cw / 2, 16 + row * (ch + gap) + ch / 2);
    v.eventMode = 'static';
    v.cursor = 'pointer';
    v.on('pointerover', () => { void tweens.to(v.scale, { x: sc * 1.08, y: sc * 1.08 }, 100, { unscaled: true }); opts.onHover?.(i, v); sfx('cardHover'); });
    v.on('pointerout', () => { void tweens.to(v.scale, { x: sc, y: sc }, 100, { unscaled: true }); opts.onHover?.(i, null); });
    v.on('pointertap', (e) => {
      if (box.wasDrag) return;
      if (e.button === 2) { inspectCard(c.id, c.up); return; }
      if (opts.onPick) opts.onPick(i, v); else inspectCard(c.id, c.up);
    });
    box.content.addChild(v);
    views.push(v);
  });
  box.refresh();
  return { box, views };
}

export function openDeck(cards: CardRef[] | { id: string; up: boolean }[], titleText: string, o: { sort?: boolean; note?: string } = {}) {
  const m = new Modal(1640, 940, { title: `${titleText}（${cards.length}）` });
  const list = o.sort === false ? cards : sortCards(cards);
  // filters: card type and cost (only offered when there is something to filter)
  let type = 'all', cost = -1;
  const bar = new Container();
  const gridHolder = new Container();
  m.body.addChild(bar, gridHolder);
  const types = ['all', ...TYPE_ORDER.filter((t) => list.some((c) => content().card(c.id, c.up).type === t))];
  const costOf = (c: { id: string; up: boolean }) => { const g = content().card(c.id, c.up).cost.g; return g === 'X' ? 0 : g; };
  const render = () => {
    bar.removeChildren().forEach((x) => x.destroy({ children: true }));
    let x = 30;
    if (list.length > 8) {
      for (const t of types) {
        const b = new Button(t === 'all' ? '全部' : TYPE_NAME[t] ?? t, { width: 96, height: 44, fontSize: fs(19), kind: type === t ? 'primary' : 'ghost', onClick: () => { type = t; render(); } });
        b.position.set(x, 96); bar.addChild(b); x += 104;
      }
      x += 30;
      for (const [cv, name] of [[-1, '任意费用'], [0, '0 费'], [1, '1 费'], [2, '2 费'], [3, '3 费+']] as [number, string][]) {
        const b = new Button(name, { width: cv < 0 ? 128 : 88, height: 44, fontSize: fs(19), kind: cost === cv ? 'primary' : 'ghost', onClick: () => { cost = cv; render(); } });
        b.position.set(x, 96); bar.addChild(b); x += (cv < 0 ? 128 : 88) + 8;
      }
    }
    const shown = list.filter((c) => (type === 'all' || content().card(c.id, c.up).type === type) && (cost < 0 || (cost >= 3 ? costOf(c) >= 3 : costOf(c) === cost)));
    gridHolder.removeChildren().forEach((g) => g.destroy({ children: true }));
    const top = list.length > 8 ? 152 : 100;
    const { box } = cardGrid(shown, { width: 1580, height: 900 - top });
    box.position.set(30, top);
    gridHolder.addChild(box);
  };
  render();
  if (o.note) { const n = label(o.note, { fontSize: fs(18), fill: C.textDim }); n.position.set(40, 900); m.body.addChild(n); }
  return m;
}

/** large inspect view with upgrade comparison and keyword glossary */
export function inspectCard(id: string, up: boolean) {
  const def = content().card(id, up);
  const m = new Modal(1500, 900, { title: def.name + (up ? '+' : '') });
  const v = new CardView({ id, up });
  v.scale.set(1.45);
  v.position.set(360, 470);
  m.body.addChild(v);
  const hasUp = !!content().card(id).upgrade;
  if (hasUp) {
    const other = new CardView({ id, up: !up });
    other.scale.set(1.05);
    other.position.set(810, 450);
    other.alpha = 0.92;
    m.body.addChild(other);
    const t = label(up ? '升级前' : '升级后', { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(26), fill: up ? C.textDim : C.jade });
    t.anchor.set(0.5);
    t.position.set(810, 205);
    m.body.addChild(t);
  }
  const terms = termsOf(def.text + ' ' + (content().card(id).upgrade?.text ?? ''));
  const lines: { title: string; body: string; color?: number }[] = [costExplain(def), ...glossLines(terms)];
  let y = 130;
  const tx = hasUp ? 1060 : 760;
  const w = 1500 - INSET.dark.x - 20 - tx; // stay inside the modal border
  for (const l of lines) {
    const t = new Text({ text: l.title, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(26), fill: l.color ?? C.goldLight } });
    t.position.set(tx, y);
    m.body.addChild(t);
    y += 34;
    const { texture, result } = richTexture(l.body, { width: w, height: 200, fontSize: fs(19), color: 0xe8dcc4, align: 'left', vAlign: 'top' });
    const s = new Sprite(texture);
    s.position.set(tx, y);
    m.body.addChild(s);
    y += result.usedHeight + 18;
  }
  if (def.flavor) {
    const f = new Text({ text: `「${def.flavor}」`, style: { fontFamily: FONT_BODY, fontSize: fs(20), fill: C.textDim, fontStyle: 'italic', wordWrap: true, wordWrapWidth: w, breakWords: true } });
    f.position.set(tx, Math.max(y + 10, 700));
    m.body.addChild(f);
  }
  // full art button
  const artBtn = new Button('欣赏插画', { width: 180, height: 56, fontSize: fs(22), kind: 'ghost', onClick: () => viewArt(def.faction, id, def.name) });
  artBtn.position.set(270, 810);
  m.body.addChild(artBtn);
  return m;
}

export function viewArt(faction: string, id: string, name: string) {
  const m = new Modal(1100, 1000, { title: name, dim: 0.9 });
  assets.with(K.card(faction, id), (t) => {
    const s = new Sprite(t);
    const k = Math.min(900 / t.width, 880 / t.height);
    s.scale.set(k);
    s.position.set((1100 - t.width * k) / 2, 90);
    s.alpha = 0;
    m.body.addChild(s);
    void tweens.to(s, { alpha: 1 }, 400, { unscaled: true });
  });
  if (!assets.has(K.card(faction, id))) toast('插画尚未生成');
}

/** pick N cards from a list (remove / upgrade / transform / duplicate / discard / fetch) */
export function pickCards(cards: { id: string; up: boolean; uid: number }[], o: { title: string; n: number; min?: number; confirm: string; upgradePreview?: boolean; optional?: boolean; onDone: (uids: number[]) => void }) {
  const m = new Modal(1640, 960, { title: o.title, closable: !!o.optional });
  const picked = new Set<number>();
  const list = sortCards(cards);
  let preview: Container | null = null;
  const { box, views } = cardGrid(list, {
    width: 1580, height: 740,
    onPick: (i, v) => {
      const uid = list[i]!.uid;
      if (picked.has(uid)) { picked.delete(uid); v.setGlow('none'); }
      else {
        if (picked.size >= o.n) { const first = [...picked][0]!; picked.delete(first); views[list.findIndex((c) => c.uid === first)]?.setGlow('none'); }
        picked.add(uid); v.setGlow('selected');
      }
      btn.setDisabled(picked.size < (o.min ?? o.n));
      sfx('click');
    },
    onHover: (i, v) => {
      if (!o.upgradePreview) return;
      preview?.destroy({ children: true }); preview = null;
      if (!v) return;
      const c = list[i]!;
      const pv = new CardView({ id: c.id, up: true });
      pv.scale.set(0.95);
      pv.position.set(1640 - 180, 480);
      preview = pv;
      m.body.addChild(pv);
    },
  });
  box.position.set(30, 100);
  m.body.addChild(box);
  const btn = new Button(o.confirm, { width: 260, height: 70, kind: 'primary', disabled: (o.min ?? o.n) > 0, onClick: () => { m.close(); o.onDone([...picked]); } });
  btn.position.set(1640 / 2 - 130, 860);
  m.body.addChild(btn);
  if (o.optional) {
    const skip = new Button('放弃', { width: 180, height: 70, kind: 'ghost', onClick: () => { m.close(); o.onDone([]); } });
    skip.position.set(1640 / 2 + 160, 860);
    m.body.addChild(skip);
  }
  return m;
}

export { FONT_UI, ease };
