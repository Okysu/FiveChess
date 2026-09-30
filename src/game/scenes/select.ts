/** 主帅选择 (UI研究笔记 §14.6) */
import { Container, Sprite, Text } from 'pixi.js';
import { fs } from '../ui/profile';
import { panel as uiPanel, maskRect, pip, INSET } from '../ui/skin';
import { G, Scene } from '../core/app';
import { assets, K } from '../assets';
import { Box } from '../core/layout';
import { Button, Tooltip, glossLines, hideTip, label, showTip, title } from '../ui/widgets';
import { fitWidth } from '../ui/textwrap';
import { C, FONT_BODY, FONT_NUM, FONT_TITLE, factionColor } from '../ui/theme';
import { content } from '../../engine/content';
import type { CommanderDef, Color } from '../../engine/defs';
import { COLOR_INFO } from '../../engine/glossary';
import { richTexture } from '../ui/richtext';
import { CardView, CARD_H } from '../ui/card';
import { tweens, ease } from '../core/tween';
import { session } from '../state';
import { audio, sfx } from '../audio/audio';
import { TextInput } from '../ui/input';
import { go } from '../router';
import { inspectCard, termsOf } from '../ui/hud';
import { UNLOCK_TRACK, ASCENSION_TEXT, MASTERY_XP, MASTERY_MAX, masteryLevel, masteryTitle, effectiveLoadout } from '../../engine/meta';

const SKILL_TYPE: Record<string, string> = { passive: '被动', active: '主动', limited: '限定技', awaken: '觉醒技' };

export class SelectScene extends Scene {
  private portrait = new Container();
  private details = new Container();
  private list = new Container();
  private ascDesc!: Text;
  private selected: CommanderDef;
  private asc = 0;
  private ascText!: Text;
  private seed!: TextInput;
  private breath = 0;
  private startBtn!: Button;

  constructor() {
    super();
    const unlocked = session.profile.unlocked.commanders;
    const all = [...content().commanders.values()];
    this.selected = all.find((c) => unlocked.includes(c.id)) ?? all[0]!;
  }

  override async enter() {
    const heroes = [...content().commanders.values()].map((c) => K.hero(c.id));
    await assets.loadMany([K.bg('recruit'), ...heroes]);
    G.setBackdrop(assets.get(K.bg('recruit')), 0x6a6a6a);
    audio.playMusic('camp');
    const back = new Button('← 返回', { width: 150, height: 56, fontSize: fs(22), kind: 'ghost', onClick: () => void import('./title').then((m) => G.go(new m.TitleScene())) });
    back.position.set(24, 20);
    const head = title('选择主帅', 52);
    head.anchor.set(0.5, 0);
    head.position.set(960, 14);
    this.addChild(this.portrait, this.details, this.list, back, head);
    this.buildList();
    this.showCommander(this.selected);
    // ascension + seed + start
    const bottom = new Box({ dir: 'row', gap: 20, align: 'center' });
    bottom.add(label('逆命', { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(30), fill: C.goldLight }));
    bottom.add(new Button('◀', { width: 56, height: 56, kind: 'ghost', onClick: () => this.setAsc(this.asc - 1) }), { width: 56, height: 56 });
    this.ascText = new Text({ text: '0', style: { fontFamily: FONT_NUM, fontSize: fs(34), fill: C.goldLight, fontWeight: 'bold' } });
    bottom.add(this.ascText, { width: 50, height: 44 });
    bottom.add(new Button('▶', { width: 56, height: 56, kind: 'ghost', onClick: () => this.setAsc(this.asc + 1) }), { width: 56, height: 56 });
    this.seed = new TextInput(320, 56, '种子（可留空）');
    bottom.add(this.seed, { width: 320, height: 56 });
    this.startBtn = new Button('启　程', { width: 260, height: 80, fontSize: fs(36), kind: 'primary', onClick: () => this.start() });
    bottom.add(this.startBtn, { width: 260, height: 80 });
    bottom.layout();
    // clear of the 19-commander roster below (its school labels start at ~920)
    bottom.position.set(1860 - bottom.w, 812);
    this.addChild(bottom);
    this.ascDesc = new Text({ text: '', style: { fontFamily: FONT_BODY, fontSize: fs(20), fill: C.textDim, stroke: { color: 0, width: 3 } } });
    this.ascDesc.position.set(1860 - bottom.w, 812 + 64);
    this.ascDesc.eventMode = 'static';
    this.ascDesc.on('pointerover', (e) => { const l = (this.ascDesc as Text & { lines?: string[] }).lines ?? []; if (l.length) showTip(new Tooltip([{ title: `逆命 ${this.asc} 生效的修正`, body: l.map((x, i) => `${i + 1}. ${x}`).join('\n') }], 420), e.global.x, 520, 'above'); });
    this.ascDesc.on('pointerout', hideTip);
    this.addChild(this.ascDesc);
    this.setAsc(0);
  }

  private setAsc(v: number) {
    const max = session.profile.ascension[this.selected.id] ?? 0;
    this.asc = Math.max(0, Math.min(max, v));
    this.ascText.text = String(this.asc);
    // what this level adds (levels stack); hover lists every active modifier
    const lines = ASCENSION_TEXT.slice(1, this.asc + 1);
    this.ascDesc.text = this.asc === 0 ? `逆命 0：${ASCENSION_TEXT[0]}${max ? `（最高可选 ${max}）` : ''}` : `逆命 ${this.asc}：${ASCENSION_TEXT[this.asc]}${this.asc > 1 ? `（另含前 ${this.asc - 1} 级）` : ''}`;
    (this.ascDesc as Text & { lines?: string[] }).lines = lines;
  }

  private buildList() {
    this.list.removeChildren();
    // seven schools, 19 commanders: compact tiles, the school name above each group, the row centred
    const groups: Color[] = ['R', 'B', 'G', 'Y', 'P', 'K', 'W'];
    const TW = 76, TH = 120, PITCH = 82, GAP = 22;
    const byGroup = groups.map((f) => [...content().commanders.values()].filter((c) => c.faction === f));
    const total = byGroup.reduce((a, g) => a + g.length * PITCH, 0) + GAP * (groups.length - 1);
    let x = Math.max(20, (1920 - total) / 2);
    const unlocked = session.profile.unlocked.commanders;
    groups.forEach((f, gi) => {
      const cmds = byGroup[gi]!;
      if (!cmds.length) return;
      const tag = new Text({ text: `${COLOR_INFO[f].name}·${COLOR_INFO[f].school}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(20), fill: factionColor(f), stroke: { color: 0, width: 4 } } });
      tag.anchor.set(0.5, 1);
      tag.position.set(x + (cmds.length * PITCH - (PITCH - TW)) / 2, 952);
      fitWidth(tag, cmds.length * PITCH - 6);
      this.list.addChild(tag);
      for (const c of cmds) {
        const locked = !unlocked.includes(c.id);
        const card = new Container();
        card.position.set(x, 955);
        const bg = uiPanel(TW, TH, 'tile');
        card.addChild(bg);
        const m = maskRect(9, 9, TW - 18, TH - 18, 4);
        assets.with(K.hero(c.id), (t) => {
          const s = new Sprite(t);
          const k = TH / (t.height * 0.45);
          s.scale.set(k);
          s.position.set(TW / 2 - (t.width * k) / 2, -6);
          card.addChild(m);
          s.mask = m;
          if (locked) { s.tint = 0x000000; s.alpha = 0.7; }
          if (!card.destroyed) card.addChildAt(s, Math.min(1, card.children.length));
        });
        const nm = new Text({ text: locked ? '？？？' : c.name, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(20), fill: C.text, stroke: { color: 0, width: 4 } } });
        nm.anchor.set(0.5, 1);
        nm.position.set(TW / 2, TH - 6);
        fitWidth(nm, TW - 6);
        card.addChild(nm);
        card.eventMode = 'static';
        card.cursor = 'pointer';
        card.on('pointertap', () => {
          if (locked) { sfx('deny'); return; }
          this.selected = c;
          sfx('click');
          this.buildList();
          this.showCommander(c);
          this.setAsc(this.asc);
        });
        if (locked) {
          const step = UNLOCK_TRACK.find((s) => s.commanders?.includes(c.id));
          const pages = session.profile.pages?.length ?? 0;
          const body = !step ? '继续冒险以解锁。'
            : step.pages !== undefined ? `累计命数达到 ${step.xp}（当前 ${session.profile.xp}），或集齐 ${step.pages} 页命书残页（当前 ${pages}）后解锁。`
              : `累计命数达到 ${step.xp} 后解锁（当前 ${session.profile.xp}）。`;
          card.on('pointerover', (e) => showTip(new Tooltip([{ title: '未解锁', body }]), e.global.x, 700, 'above'));
          card.on('pointerout', hideTip);
        }
        this.list.addChild(card);
        x += PITCH;
      }
      x += GAP - (PITCH - TW);
    });
  }

  private showCommander(c: CommanderDef) {
    // portrait
    this.portrait.removeChildren();
    const tex = assets.get(K.hero(c.id));
    if (tex) {
      const s = new Sprite(tex);
      s.anchor.set(0.5, 1);
      // hero on the left third, lore panel beside it — the panel never covers the face
      // height decides the size (every commander stands as tall); a wide robe or weapon may reach under the lore panel
      const k = Math.min(780 / tex.height, 600 / tex.width);
      s.scale.set(k);
      s.position.set(250, 900);
      s.alpha = 0;
      this.portrait.addChild(s);
      void tweens.to(s, { alpha: 1 }, 350, { unscaled: true });
      (this.portrait as Container & { hero?: Sprite }).hero = s;
    }
    // details
    this.details.removeChildren();
    const panelW = 900, panelH = 730;
    const PX = INSET.dark.x, PY = INSET.dark.y;
    const bg = uiPanel(panelW, panelH, 'dark');
    this.details.position.set(960, 90);
    this.details.addChild(bg);
    const nm = new Text({ text: c.name, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(64), fill: C.goldLight, stroke: { color: 0, width: 6 } } });
    nm.position.set(PX, PY - 12);
    const tt = new Text({ text: `「${c.title}」`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(32), fill: factionColor(c.faction), stroke: { color: 0, width: 4 } } });
    tt.position.set(PX + 6 + nm.width, PY + 12);
    this.details.addChild(nm, tt);
    const info = new Text({ text: `${COLOR_INFO[c.faction].school}　生命 ${c.hp}　初始源`, style: { fontFamily: FONT_BODY, fontSize: fs(24), fill: C.text } });
    info.position.set(PX, PY + 72);
    this.details.addChild(info);
    c.sources.forEach((col, i) => {
      const pp = pip(col, 40);
      pp.position.set(PX + 30 + info.width + i * 46, PY + 88);
      this.details.addChild(pp);
    });
    const prof = session.profile;
    const mLv = masteryLevel(prof.mastery[c.id] ?? 0);
    const use = effectiveLoadout(prof, c.id);
    const setLoadout = (k: 'altRelic' | 'altSkill', v: boolean) => {
      prof.loadout[c.id] = { ...(prof.loadout[c.id] ?? {}), [k]: v };
      void session.saveProfile();
      sfx('click');
      this.showCommander(c);
    };
    /** the 精通 switch at the right end of a header row, or the level that unlocks it */
    const altSwitch = (y0: number, need: number, on: boolean, k: 'altRelic' | 'altSkill', altName: string, baseName: string, preview: { title: string; body: string }) => {
      if (mLv >= need) {
        const b = new Button(on ? `换回「${baseName}」` : `换为「${altName}」`, { width: 250, height: 46, fontSize: fs(19), kind: 'ghost', onClick: () => setLoadout(k, !on) });
        b.position.set(panelW - PX - 250, y0 - 4);
        this.details.addChild(b);
        return;
      }
      const lock = new Text({ text: `精通 ${need} 解锁「${altName}」`, style: { fontFamily: FONT_BODY, fontSize: fs(19), fill: C.textDim } });
      lock.anchor.set(1, 0);
      lock.position.set(panelW - PX, y0 + 6);
      lock.eventMode = 'static';
      lock.on('pointerover', (e) => showTip(new Tooltip([preview, ...glossLines(termsOf(preview.body))], 420), e.global.x, e.global.y));
      lock.on('pointerout', hideTip);
      this.details.addChild(lock);
    };
    let y = PY + 118;
    for (const base of c.skills) {
      const replaceable = !!c.alt && c.alt.replaces === base.id;
      const sk = replaceable && use.altSkill ? c.alt!.skill : base;
      const h = new Text({ text: `【${SKILL_TYPE[sk.type]}】${sk.name}${sk !== base ? '（另一面）' : ''}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(28), fill: sk.type === 'passive' ? C.goldLight : 0xff9a6a } });
      h.position.set(PX, y);
      this.details.addChild(h);
      if (replaceable) altSwitch(y, 5, use.altSkill, 'altSkill', c.alt!.skill.name, base.name, { title: `另一面 · ${c.alt!.skill.name}（替换「${base.name}」）`, body: c.alt!.skill.text });
      y += 40;
      const { texture, result } = richTexture(sk.text, { width: panelW - PX * 2 - 16, height: 140, fontSize: fs(21), minFontSize: 16, color: 0xeadfc8, align: 'left', vAlign: 'top' });
      const s = new Sprite(texture);
      s.position.set(PX + 16, y);
      s.eventMode = 'static';
      s.on('pointerover', (e) => { const g = glossLines(termsOf(sk.text)); if (g.length) showTip(new Tooltip(g), e.global.x, e.global.y); });
      s.on('pointerout', hideTip);
      this.details.addChild(s);
      y += result.usedHeight + 16;
    }
    const relic = content().relics.get(use.altRelic && c.alt ? c.alt.relic : c.relic);
    if (relic) {
      const h = new Text({ text: `专属遗物：${relic.name}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(26), fill: C.goldLight } });
      h.position.set(PX, y);
      this.details.addChild(h);
      const altRelic = c.alt ? content().relics.get(c.alt.relic) : undefined;
      const baseRelic = content().relics.get(c.relic);
      if (altRelic && baseRelic) altSwitch(y, 3, use.altRelic, 'altRelic', altRelic.name, baseRelic.name, { title: `第二件起始遗物 · ${altRelic.name}`, body: altRelic.text });
      y += 36;
      const { texture, result } = richTexture(relic.text, { width: panelW - PX * 2 - 16, height: 100, fontSize: fs(20), color: 0xd8ccb4, align: 'left', vAlign: 'top' });
      const s = new Sprite(texture);
      s.position.set(PX + 16, y);
      this.details.addChild(s);
      y += result.usedHeight + 16;
    }
    // starter deck mini-cards
    const deckLbl = new Text({ text: `初始牌组（${c.deck.length}）`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(24), fill: C.textDim } });
    const deckY = Math.max(y, 460);
    deckLbl.position.set(PX, deckY);
    this.details.addChild(deckLbl);
    const uniq = [...new Set(c.deck)];
    // the mini cards take the room left above the bottom stats line (long skill texts push the row down)
    const cardK = Math.max(0.24, Math.min(0.34, (panelH - PY - (deckY + 40)) / CARD_H));
    uniq.forEach((id, i) => {
      const v = new CardView({ id, up: false });
      v.scale.set(cardK);
      v.position.set(PX + 52 + i * 112, deckY + 40 + (CARD_H * cardK) / 2);
      v.eventMode = 'static';
      v.cursor = 'pointer';
      v.on('pointertap', () => inspectCard(id, false));
      const n = c.deck.filter((x) => x === id).length;
      if (n > 1) {
        const badge = new Text({ text: `×${n}`, style: { fontFamily: FONT_NUM, fontSize: fs(60), fontWeight: 'bold', fill: C.goldLight, stroke: { color: 0, width: 8 } } });
        badge.anchor.set(1, 1);
        badge.position.set(300, 420);
        v.addChild(badge);
      }
      this.details.addChild(v);
    });
    const st = session.profile.commanderStats[c.id];
    const xp = prof.mastery[c.id] ?? 0;
    const next = MASTERY_XP[mLv];
    const ttl = masteryTitle(prof, c.id);
    const mastery = `精通 ${mLv}${mLv < MASTERY_MAX && next !== undefined ? `（${xp}/${next}）` : '（满）'}${ttl ? ` · ${ttl}` : ''}`;
    // 精通 sits top-right of the panel (the bottom line is shared with the starter deck row)
    const mText = new Text({ text: mastery, style: { fontFamily: FONT_BODY, fontSize: fs(20), fill: C.goldLight } });
    mText.anchor.set(1, 0);
    mText.position.set(panelW - PX, PY - 4);
    this.details.addChild(mText);
    // on the deck label row, right-aligned: the bottom of the panel belongs to the mini cards
    const stats = new Text({ text: st ? `出征 ${st.runs} · 通关 ${st.wins} · 逆命 ${st.highestAsc} · 最远 ${st.bestFloor} 层` : '尚无战绩', style: { fontFamily: FONT_BODY, fontSize: fs(18), fill: C.textDim } });
    stats.anchor.set(1, 0);
    stats.position.set(panelW - PX, deckY + 4);
    this.details.addChild(stats);
    const lore = new Text({ text: c.lore, style: { fontFamily: FONT_BODY, fontSize: fs(20), fill: C.text, wordWrap: true, wordWrapWidth: 330, lineHeight: 32, breakWords: true } });
    lore.position.set(40, 100);
    lore.alpha = 0.85;
    const loreBox = new Container();
    const lb = uiPanel(330 + INSET.dark.x * 2, lore.height + INSET.dark.y * 2, 'dark');
    loreBox.addChild(lb);
    lore.position.set(INSET.dark.x, INSET.dark.y);
    loreBox.addChild(lore);
    loreBox.position.set(478, 240);
    this.portrait.addChild(loreBox);
  }

  private start() {
    session.startRun(this.selected.id, this.asc, this.seed.value);
    sfx('turnPlayer');
    void go(true);
  }

  override update(dt: number) {
    this.breath += dt;
    const hero = (this.portrait as Container & { hero?: Sprite }).hero;
    if (hero) { const k = Math.sin(this.breath / 900) * 0.008; hero.scale.y = hero.scale.x * (1 + k); }
    this.seed?.tick(dt);
  }
}

export { ease };
