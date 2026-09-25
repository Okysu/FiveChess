/**
 * 战斗界面 (UI研究笔记 §14.1). The engine resolves each action completely and returns an ordered
 * event list; this scene plays those events as animations, then re-syncs every view from state.
 * The presentation never mutates game state.
 */
import { Container, Graphics, Sprite, Text, type FederatedPointerEvent } from 'pixi.js';
import { G, Scene } from '../../core/app';
import { assets, K } from '../../assets';
import { session } from '../../state';
import { go } from '../../router';
import { act, attackOptions, noActionsLeft, playableInfo, potionTargets, skillUsable, canSacrifice } from '../../../engine/combat/api';
import type { CEvent, CombatState, PlayerAction, Unit, CardInst, FateCard } from '../../../engine/combat/state';
import { alive, attackTargets, canAttack, commanderOf, unit, unitsOf, atkOf, emptySlots } from '../../../engine/combat/board';
import { cardDef, cardTargets, responseOptions, isResponse, calcDamage, planPayment, effectiveCost, isRangedAttacker } from '../../../engine/combat/core';
import { intentPreview } from '../../../engine/combat/intents';
import { skillDef } from '../../../engine/combat/skills';
import { autoAnswer } from '../../../engine/combat/autoplay';
import { content } from '../../../engine/content';
import { STATUSES, SUIT_INFO } from '../../../engine/glossary';
import { TopBar, openDeck, inspectCard, pickCards, termsOf, sortCards } from '../../ui/hud';
import { Button, Modal, Tooltip, glossLines, hideTip, label, showTip, title, toast } from '../../ui/widgets';
import { CardView, CARD_H } from '../../ui/card';
import { C, FONT_BODY, FONT_NUM, FONT_TITLE } from '../../ui/theme';
import { WB, uiSprite, dim, hitRect, nine, panel, INSET, frame, ring as ringSprite, sectorMask, maskCircle } from '../../ui/skin';
import { tweens, ease, wait } from '../../core/tween';
import { audio, sfx } from '../../audio/audio';
import { Particles, fxTexture, floatText, shake, hitStop, dissolve, preloadFx } from '../../fx/fx';
import { UnitView } from './unitView';
import { HandView } from './handView';
import { Arrow } from './arrow';
import { FateArea, FateCardView } from './fateView';
import { SourceTray, Pile, EquipRow, SkillRow, FieldSlot } from './hudViews';
import { liveCard, predictCardDamage } from './live';
import { slotPos, PLAY_LINE_Y, STAGE, PILES, ALTAR, END_BTN, FATE, X, CMD_Y } from './layout';

type Targeting =
  | { kind: 'card'; view: CardView; card: CardInst; targets: number[] | null; slots: { row: 'front' | 'back'; slot: number }[] | null; response?: boolean }
  | { kind: 'attack'; attacker: number; targets: number[] }
  | { kind: 'skill'; index: number; targets: number[] }
  | { kind: 'potion'; slot: number; targets: number[] };

export class CombatScene extends Scene {
  s!: CombatState;
  // layers
  private boardLayer = new Container();
  private unitLayer = new Container();
  private unitUi = new Container();
  private hudLayer = new Container();
  private hand = new HandView();
  private dragLayer = new Container();
  private sigLayer = new Container();
  private fxLayer = new Particles();
  private numLayer = new Container();
  private shakeRoot = new Container();
  // views
  private units = new Map<number, UnitView>();
  private slotGfx: { row: 'front' | 'back'; slot: number; g: Container; x: number; y: number }[] = [];
  private fate = new FateArea();
  private tray = new SourceTray();
  private drawPile!: Pile;
  private discardPile!: Pile;
  private exhaustPile!: Pile;
  private endBtn!: Button;
  private respModeBtn!: Button;
  private top!: TopBar;
  private skills = new SkillRow();
  private pEquip = new EquipRow('player');
  private eEquip = new EquipRow('enemy');
  private pField = new FieldSlot('player', 770, 690);
  private eField = new FieldSlot('enemy', 1150, 690);
  private arrow = new Arrow();
  private banner = new Container();
  private logLines: string[] = [];
  private bossHand = new Container();
  // state
  private busy = false;
  private targeting: Targeting | null = null;
  private dragging: { view: CardView; offX: number; offY: number; started: boolean; sx: number; sy: number } | null = null;
  private selected: CardView | null = null;
  private attackerHover: UnitView | null = null;
  private pendingReturn: UnitView | null = null;
  private judgeView: FateCardView | null = null;
  private windowUi: Container | null = null;
  private windowTimer = 0;
  private windowTotal = 0;
  private stage: CardView | null = null;
  private enemyStage: CardView | null = null;
  private popKeys: (() => void) | null = null;
  private ending = false;
  private ambientSpawn?: () => void;
  private ambAcc = 0;

  override async enter() {
    this.s = session.ensureCombat();
    const s = this.s;
    const r = session.run!;
    await this.preload();
    G.setBackdrop(assets.get(K.bg(`battle_${Math.min(4, r.act)}`)), 0x9c9c9c); // printed backdrop pushed back so the board reads first
    const enc = content().encounters.get(s.cfg.encounter);
    const tier = enc?.tier ?? 'normal';
    audio.playMusic(r.act === 4 ? 'final' : tier === 'boss' ? 'boss' : tier === 'elite' ? 'elite' : 'battle');
    audio.ambience((['forest', 'water', 'stars', 'void'] as const)[r.act - 1] ?? null);

    this.addChild(this.shakeRoot);
    const bottomBar = dim(1920, 310, 0.45, 0, 770);
    this.shakeRoot.addChild(bottomBar, this.boardLayer, this.unitLayer, this.unitUi, this.fxLayer, this.hudLayer, this.hand, this.dragLayer, this.numLayer, this.sigLayer);
    this.ambientSpawn = this.fxLayer.ambient(r.act === 1 ? 'dust' : r.act === 2 ? 'dust' : r.act === 3 ? 'stars' : 'ink', 1920, 760, 0.2);

    this.buildBoard();
    this.buildHud();
    this.top = new TopBar(r, {
      hp: () => { const pc = commanderOf(this.s, 'player'); return { hp: pc?.hp ?? 0, max: pc?.baseMaxHp ?? 1, armor: pc?.armor ?? 0 }; },
      potions: () => this.s.potions,
      onPotion: (i) => this.startPotion(i),
      onDeck: () => openDeck(session.run!.deck, '牌组'),
      onSettings: () => void import('../settings').then((m) => m.openSettings()),
      onCodex: () => void import('../codex').then((m) => m.openCodexModal()),
    });
    this.addChild(this.top);
    this.dragLayer.addChild(this.arrow);
    this.sigLayer.addChild(this.banner);

    // input
    // passive scene + a full-screen static hit layer at the bottom: decorative layers never block clicks
    this.eventMode = 'passive';
    const bgHit = hitRect(-400, -200, 2720, 1480);
    this.addChildAt(bgHit, 0);
    bgHit.on('globalpointermove', (e) => this.onMove(e));
    // release is read from the window: the scene is passive (receives no events itself) and a drag
    // can end anywhere — over a unit, a button, or outside the canvas
    this.windowUp = (ev: PointerEvent) => {
      const r = G.app.canvas.getBoundingClientRect();
      const gx = (ev.clientX - r.left) * (G.app.screen.width / r.width);
      const gy = (ev.clientY - r.top) * (G.app.screen.height / r.height);
      void this.onUp({ global: { x: gx, y: gy }, button: ev.button } as unknown as FederatedPointerEvent);
    };
    window.addEventListener('pointerup', this.windowUp);
    bgHit.on('pointerdown', (e) => this.onBackgroundDown(e));
    this.hand.onPress = (v, e) => this.onCardPress(v, e);
    this.hand.onHover = (v) => this.onCardHover(v);
    this.hand.onRightClick = (v) => inspectCard(v.cardId, v.up);
    this.hand.onEmptyPress = () => { if (this.selected || this.targeting) { this.cancelTargeting(); this.clearSelection(); } };
    this.popKeys = G.pushKeys((e) => this.onKeyDown(e));

    // initial views
    for (const u of Object.values(s.units)) if (!u.removed && !u.dead) this.ensureUnit(u);
    this.syncAll(false);
    // intro: cards dealt from the draw pile
    this.hand.views.forEach((v, i) => { v.position.set(PILES.draw.x, PILES.draw.y); v.scale.set(0.3); void wait(i * 80); });
  }

  override async shown() {
    this.hand.layout(true, 420);
    await this.intro();
    if (this.s.pending) await this.handlePending();
    else if (this.s.over) await this.finish();
  }

  override exit() {
    if (this.windowUp) window.removeEventListener('pointerup', this.windowUp);
    this.popKeys?.();
    hideTip();
  }

  private async preload() {
    const s = this.s;
    const c = content();
    const keys: string[] = [K.bg(`battle_${Math.min(4, session.run!.act)}`), K.hero(s.cfg.commander)];
    for (const u of Object.values(s.units)) {
      if (u.origin === 'enemy') keys.push(K.enemy(u.def, c.enemies.get(u.def)?.tier === 'boss'));
      else if (u.origin === 'card' || u.origin === 'token') keys.push(K.card(c.card(u.def).faction, u.def));
    }
    for (const card of [...s.draw, ...s.hand, ...s.discard]) keys.push(K.card(c.card(card.id).faction, card.id));
    // enemy summons & boss deck
    for (const e of c.enemies.values()) if (e.act === session.run!.act && e.tier === 'minion') keys.push(K.enemy(e.id));
    keys.push(K.ui('card_back'), K.ui('fate_back'));
    await Promise.all([assets.loadMany(keys), preloadFx()]);
  }

  // ═════════════ board construction ═════════════

  private buildBoard() {
    // slots
    for (const side of ['player', 'enemy'] as const) {
      for (const row of ['front', 'back'] as const) {
        const n = row === 'front' ? 4 : 3;
        for (let i = 0; i < n; i++) {
          const p = slotPos(side, row, i);
          const tile = uiSprite('slot', 124, 124);
          tile.position.set(p.x, p.y + 6);
          tile.alpha = 0.5;
          this.boardLayer.addChild(tile);
          const g = new Container();
          g.position.set(p.x, p.y);
          this.drawSlot(g, side, row, 'idle');
          this.boardLayer.addChild(g);
          if (side === 'player') this.slotGfx.push({ row, slot: i, g, x: p.x, y: p.y });
        }
      }
    }
    // row labels
    const mk = (t: string, x: number) => { const l = label(t, { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 18, fill: C.textDim }); l.anchor.set(0.5); l.position.set(x, 112); l.alpha = 0.7; this.boardLayer.addChild(l); };
    mk('后阵', X.playerBack); mk('前阵', X.playerFront); mk('前阵', X.enemyFront); mk('后阵', X.enemyBack);
    this.boardLayer.addChild(this.pField, this.eField, this.fate);
  }

  /** slot state overlay: generated selection frames only */
  private drawSlot(g: Container, side: 'player' | 'enemy', row: 'front' | 'back', state: 'idle' | 'drop' | 'hover' | 'full') {
    void side; void row;
    const key = `slot:${state}`;
    if ((g as Container & { slotState?: string }).slotState === key) return;
    (g as Container & { slotState?: string }).slotState = key;
    g.removeChildren().forEach((c) => c.destroy({ children: true }));
    const w = 118, h = 142;
    if (state === 'drop' || state === 'hover') {
      const f = frame(state === 'hover' ? 'red' : 'gold', w, h, 6);
      f.position.set(-w / 2 - 6, -h / 2 - 6);
      g.addChild(f);
    }
    g.alpha = state === 'full' ? 0.4 : 1;
  }

  private buildHud() {
    // commander extras (left)
    this.skills.position.set(70, 560);
    this.skills.onUse = (i) => this.startSkill(i);
    this.pEquip.position.set(66, 650);
    this.eEquip.position.set(1640, 650);
    this.bossHand.position.set(1660, 600);
    this.hudLayer.addChild(this.skills, this.pEquip, this.eEquip, this.bossHand, this.tray);
    this.drawPile = new Pile('draw', PILES.draw.x, PILES.draw.y, () => openDeck([...this.s.draw].sort(() => 0).map((c) => ({ id: c.id, up: c.up })), '抽牌堆', { note: '顺序已隐藏' }));
    this.discardPile = new Pile('discard', PILES.discard.x, PILES.discard.y, () => openDeck(this.s.discard.map((c) => ({ id: c.id, up: c.up })), '弃牌堆', { sort: false }));
    this.exhaustPile = new Pile('exhaust', PILES.exhaust.x, PILES.exhaust.y, () => openDeck(this.s.exhaust.map((c) => ({ id: c.id, up: c.up })), '燃尽堆', { sort: false }));
    this.hudLayer.addChild(this.drawPile, this.discardPile, this.exhaustPile);
    this.endBtn = new Button('结束回合', { width: END_BTN.w, height: END_BTN.h, fontSize: 32, kind: 'primary', onClick: () => this.endTurn() });
    this.endBtn.position.set(END_BTN.x, END_BTN.y);
    this.respModeBtn = new Button(this.respModeText(), { width: 220, height: 40, fontSize: 18, kind: 'ghost', onClick: () => this.cycleRespMode() });
    this.respModeBtn.position.set(1660, 740);
    this.hudLayer.addChild(this.endBtn, this.respModeBtn);
    this.tray.altar.on('pointertap', () => { if (this.selected) void this.trySacrifice(this.selected); });
    // log drawer toggle
    const logBtn = new Button('战报', { width: 90, height: 40, fontSize: 18, kind: 'ghost', onClick: () => this.showLog() });
    logBtn.position.set(1560, 740);
    this.hudLayer.addChild(logBtn);
  }

  private respModeText() { return `应对：${{ always: '总是询问', smart: '智能', never: '跳过' }[session.settings.responseMode]}`; }
  private cycleRespMode() {
    const order = ['always', 'smart', 'never'] as const;
    const i = order.indexOf(session.settings.responseMode);
    session.settings.responseMode = order[(i + 1) % 3]!;
    void session.saveSettings();
    this.respModeBtn.setText(this.respModeText());
  }

  // ═════════════ sync ═════════════

  private ensureUnit(u: Unit): UnitView {
    let v = this.units.get(u.uid);
    if (v) return v;
    v = new UnitView(u);
    const p = slotPos(u.side, u.row, u.slot);
    v.position.set(p.x, p.y);
    this.units.set(u.uid, v);
    this.unitLayer.addChild(v);
    v.on('pointerover', (e) => this.onUnitHover(v!, e));
    v.on('pointerout', () => this.onUnitOut(v!));
    v.on('pointerdown', (e) => this.onUnitDown(v!, e));
    v.on('pointertap', (e) => this.onUnitTap(v!, e));
    return v;
  }

  syncAll(animateHand = true) {
    const s = this.s;
    // units
    for (const u of Object.values(s.units)) {
      if (u.removed || u.dead) {
        const v = this.units.get(u.uid);
        if (v) { v.destroy({ children: true }); this.units.delete(u.uid); }
        continue;
      }
      const v = this.ensureUnit(u);
      const p = slotPos(u.side, u.row, u.slot);
      if (v !== this.pendingReturn) v.position.set(p.x, p.y);
      v.sync(s, u);
    }
    this.syncIncoming();
    // hand
    this.hand.reconcile(s.hand, (c) => liveCard(s, c));
    this.refreshPlayable();
    this.hand.layout(animateHand);
    // hud
    this.tray.sync(s);
    this.tray.setAltar(canSacrifice(s) && s.hand.length > 0 ? 'ready' : 'used');
    this.fate.sync(s);
    this.drawPile.set(s.draw.length);
    this.discardPile.set(s.discard.length);
    this.exhaustPile.set(s.exhaust.length);
    this.skills.sync(s);
    this.pEquip.sync(s);
    this.eEquip.sync(s);
    this.pField.sync(s);
    this.eField.sync(s);
    this.syncBossHand();
    this.top.refresh();
    this.updateEndButton();
  }

  private syncBossHand() {
    this.bossHand.removeChildren();
    const sd = this.s.sides.enemy;
    if (sd.commander == null || !content().enemies.get(unit(this.s, sd.commander)?.def ?? '')?.deck) return;
    sd.hand.forEach((_, i) => {
      const b = new CardView({ id: sd.hand[i]!.id, up: false });
      b.setFaceDown(true);
      b.scale.set(0.16);
      b.rotation = (i - (sd.hand.length - 1) / 2) * 0.15;
      b.position.set(i * 26, 0);
      this.bossHand.addChild(b);
    });
    const t = new Text({ text: `气 ${sd.energy}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 20, fill: 0xffc8a0, stroke: { color: 0, width: 4 } } });
    t.position.set(110, -12);
    this.bossHand.addChild(t);
  }

  private syncIncoming() {
    const s = this.s;
    const inc = new Map<number, { total: number; n: number }>();
    for (const e of unitsOf(s, 'enemy', true)) {
      const pv = intentPreview(s, e);
      if (!pv || !pv.damage || pv.target == null) continue;
      const cur = inc.get(pv.target) ?? { total: 0, n: 0 };
      cur.total += pv.damage * (pv.hits ?? 1);
      cur.n++;
      inc.set(pv.target, cur);
    }
    for (const [uid, v] of this.units) {
      const u = s.units[uid];
      if (!u || u.side !== 'player') continue;
      const x = inc.get(uid);
      v.setIncoming(x?.total ?? 0, x?.n ?? 0);
    }
  }

  private refreshPlayable() {
    const s = this.s;
    const win = s.pending?.kind === 'response' ? s.pending.options : null;
    for (const v of this.hand.views) {
      const card = s.hand.find((c) => c.uid === v.cardUid);
      if (!card) continue;
      if (win) { v.setGlow(win.includes(card.uid) ? 'response' : 'none'); continue; }
      const ok = s.phase === 'main' && !this.busy && playableInfo(s, card).playable;
      v.setGlow(v === this.selected ? 'selected' : ok ? 'playable' : 'none');
    }
    this.hand.lifted = new Set(win ?? []);
    this.hand.dimmed = s.active === 'enemy';
    this.hand.sunk = s.active === 'enemy' && !win ? 40 : 0;
  }

  private updateEndButton() {
    const s = this.s;
    if (s.pending?.kind === 'response') return;
    if (s.active === 'enemy' || this.busy) { this.endBtn.setText('敌方回合'); this.endBtn.setDisabled(true); this.endBtn.pulse = false; this.endBtn.setKind('normal'); return; }
    this.endBtn.setDisabled(false);
    this.endBtn.setText('结束回合');
    this.endBtn.setKind('primary');
    this.endBtn.pulse = noActionsLeft(s);
    this.endBtn.draw();
  }

  // ═════════════ actions ═════════════

  private async send(a: PlayerAction): Promise<boolean> {
    if (this.busy) return false;
    const r = act(this.s, a);
    if (!r.ok) { toast(reasonText(r.error ?? '')); sfx('deny'); return false; }
    this.busy = true;
    this.updateEndButton();
    this.refreshPlayable();
    try { await this.play(r.events); }
    catch (e) { console.error(e); }
    this.busy = false;
    this.syncAll();
    void session.saveRun();
    if (this.s.over) { await this.finish(); return true; }
    if (this.s.pending) await this.handlePending();
    return true;
  }

  private async endTurn() {
    if (this.busy || this.s.phase !== 'main' || this.s.pending) return;
    if (session.settings.confirmEndTurn && !noActionsLeft(this.s)) {
      const m = new Modal(640, 300, { title: '仍有可用行动' });
      const ok = new Button('结束回合', { width: 220, height: 64, kind: 'primary', onClick: () => { m.close(); void this.doEndTurn(); } });
      ok.position.set(80, 180);
      const no = new Button('再想想', { width: 220, height: 64, kind: 'ghost', onClick: () => m.close() });
      no.position.set(340, 180);
      m.body.addChild(ok, no);
      return;
    }
    await this.doEndTurn();
  }

  private async doEndTurn() {
    this.cancelTargeting();
    sfx('endTurn');
    await this.send({ type: 'endTurn' });
  }

  // ═════════════ input: cards ═════════════

  private onCardHover(v: CardView | null) {
    hideTip();
    if (!v) { this.tray.highlight(null, this.s); return; }
    const card = this.s.hand.find((c) => c.uid === v.cardUid);
    if (!card) return;
    const info = playableInfo(this.s, card);
    const plan = info.payment ?? planPayment(this.s, effectiveCost(this.s, card), card);
    this.tray.highlight(plan ?? null, this.s);
    const lines = glossLines(v.rulesTerms);
    if (lines.length) showTip(new Tooltip(lines, 340), v.x + 160, 560);
  }

  private onCardPress(v: CardView, e: FederatedPointerEvent) {
    if (this.busy && this.s.pending?.kind !== 'response') return;
    const p = G.toDesign(e.global.x, e.global.y);
    this.dragging = { view: v, offX: 0, offY: 0, started: false, sx: p.x, sy: p.y };
  }

  private beginDrag(v: CardView) {
    const card = this.s.hand.find((c) => c.uid === v.cardUid);
    if (!card) return;
    const inWindow = this.s.pending?.kind === 'response';
    if (inWindow && !(this.s.pending as { options: number[] }).options.includes(card.uid)) { this.shakeCard(v, card); this.dragging = null; return; }
    if (!inWindow) {
      const info = playableInfo(this.s, card);
      if (!info.playable && !canSacrifice(this.s)) { this.shakeCard(v, card); this.dragging = null; return; }
    }
    this.hand.frozen = v;
    this.hand.hovered = null;
    this.hand.layout(true);
    hideTip();
    this.hand.removeChild(v);
    this.dragLayer.addChild(v);
    void tweens.to(v.scale, { x: 0.8, y: 0.8 }, 120, { key: `handS:${v.cardUid}` });
    this.dragging!.started = true;
    // show drop targets
    const def = cardDef(card);
    if (def.type === 'unit' && !inWindow) for (const sg of this.slotGfx) this.drawSlot(sg.g, 'player', sg.row, emptySlots(this.s, 'player', sg.row).includes(sg.slot) ? 'drop' : 'full');
    this.tray.setAltar(canSacrifice(this.s) ? 'ready' : 'used');
  }

  private shakeCard(v: CardView, card: CardInst) {
    sfx('deny');
    const ox = v.x;
    void tweens.run(240, (k) => { v.x = ox + Math.sin(k * Math.PI * 6) * 8 * (1 - k); }, { unscaled: true }).then(() => { v.x = ox; });
    const info = playableInfo(this.s, card);
    const live = liveCard(this.s, card);
    if (info.reason === 'cost') {
      const need = effectiveCost(this.s, card);
      const ready = this.s.sources.filter((x) => x.ready).length;
      toast(live.missing?.length ? `缺少 ${live.missing.map((c) => ({ R: '赤', B: '玄', G: '青', Y: '金', P: '紫', N: '素' })[c]).join('')} 源` : `源不足（需 ${need.g + need.c.length}，余 ${ready}）`, 0xff9a8a, 760);
    } else if (info.reason === 'window') toast('此牌只能在应对窗口中打出', 0xff9a8a, 760);
    else if (info.reason === 'target') toast('没有合法目标', 0xff9a8a, 760);
    else if (info.reason === 'slot') toast('阵地已满', 0xff9a8a, 760);
    else if (info.reason === 'unplayable') toast('无法打出', 0xff9a8a, 760);
  }

  private onMove(e: FederatedPointerEvent) {
    const p = G.toDesign(e.global.x, e.global.y);
    if (this.dragging) {
      const d = this.dragging;
      if (!d.started) {
        if (Math.hypot(p.x - d.sx, p.y - d.sy) > 12) this.beginDrag(d.view);
        if (!this.dragging?.started) return;
      }
      const v = d.view;
      const card = this.s.hand.find((c) => c.uid === v.cardUid);
      if (!card) return;
      const def = cardDef(card);
      const needsTarget = !!cardTargets(this.s, 'player', def) && def.type !== 'unit';
      const overAltar = Math.hypot(p.x - ALTAR.x, p.y - ALTAR.y) < 90;
      this.tray.setAltar(overAltar && canSacrifice(this.s) ? 'hot' : canSacrifice(this.s) ? 'ready' : 'used');
      if (needsTarget && p.y < PLAY_LINE_Y && !overAltar) {
        // snap to stage and aim
        if (!this.targeting) this.startCardTargeting(v, card);
        void tweens.to(v, { x: STAGE.x, y: STAGE.y, rotation: 0 }, 120, { key: `drag:${v.cardUid}` });
        this.aim(p);
      } else {
        if (this.targeting?.kind === 'card') { this.cancelTargeting(false); }
        const tilt = Math.max(-0.25, Math.min(0.25, (p.x - v.x) * 0.01));
        v.position.set(p.x, p.y);
        v.rotation = tilt;
        if (def.type === 'unit') this.hoverSlot(p);
      }
      return;
    }
    if (this.targeting) this.aim(p);
  }

  private async onUp(e: FederatedPointerEvent) {
    const p = G.toDesign(e.global.x, e.global.y);
    const d = this.dragging;
    if (d) {
      this.dragging = null;
      if (!d.started) {
        // tap on card = select
        this.onCardTap(d.view);
        return;
      }
      await this.dropCard(d.view, p);
      return;
    }
    if (this.targeting && this.targeting.kind === 'attack' && this.attackDragging) {
      this.attackDragging = false;
      const t = this.targetAt(p);
      if (t && this.targeting.targets.includes(t.unitUid)) await this.commitTarget(t.unitUid);
      else if (Math.hypot(p.x - this.attackStart.x, p.y - this.attackStart.y) > 20) this.cancelTargeting();
    }
  }

  private attackDragging = false;
  private windowUp?: (ev: PointerEvent) => void;
  private attackStart = { x: 0, y: 0 };

  private onCardTap(v: CardView) {
    const card = this.s.hand.find((c) => c.uid === v.cardUid);
    if (!card) return;
    if (this.selected === v) {
      // tapping the selected card again plays it if it needs no target
      const def = cardDef(card);
      const tg = cardTargets(this.s, 'player', def);
      if (!tg && def.type !== 'unit') { void this.playCard(v, card, null, null); return; }
      this.clearSelection();
      return;
    }
    this.clearSelection();
    const inWindow = this.s.pending?.kind === 'response';
    const info = playableInfo(this.s, card);
    if (!inWindow && !info.playable && !canSacrifice(this.s)) { this.shakeCard(v, card); return; }
    this.selected = v;
    this.hand.lifted.add(v.cardUid);
    this.refreshPlayable();
    this.hand.layout(true);
    sfx('click');
    const def = cardDef(card);
    if (def.type === 'unit') { for (const sg of this.slotGfx) this.drawSlot(sg.g, 'player', sg.row, emptySlots(this.s, 'player', sg.row).includes(sg.slot) ? 'drop' : 'full'); toast('点击空阵位放置随从 · 点空白处取消', 0xf0e4cc, 760); }
    else if (cardTargets(this.s, 'player', def)) this.startCardTargeting(v, card, true);
    else if (info.playable || inWindow) toast('再点一次此牌打出（或拖到战场）· 点空白处取消', 0xf0e4cc, 760);
  }

  private clearSelection() {
    if (this.selected) this.hand.lifted.delete(this.selected.cardUid);
    this.selected = null;
    if (this.targeting?.kind === 'card') this.cancelTargeting(false);
    for (const sg of this.slotGfx) this.drawSlot(sg.g, 'player', sg.row, 'idle');
    this.refreshPlayable();
    this.hand.layout(true);
  }

  private async dropCard(v: CardView, p: { x: number; y: number }) {
    const card = this.s.hand.find((c) => c.uid === v.cardUid);
    for (const sg of this.slotGfx) this.drawSlot(sg.g, 'player', sg.row, 'idle');
    if (!card) { this.returnToHand(v); return; }
    const def = cardDef(card);
    const inWindow = this.s.pending?.kind === 'response';
    // sacrifice
    if (!inWindow && Math.hypot(p.x - ALTAR.x, p.y - ALTAR.y) < 90) { await this.trySacrifice(v); return; }
    if (p.y > PLAY_LINE_Y && !this.targeting) { this.returnToHand(v); return; }
    if (def.type === 'unit' && !inWindow) {
      const slot = this.slotAt(p);
      if (slot && emptySlots(this.s, 'player', slot.row).includes(slot.slot)) { await this.playCard(v, card, null, slot); return; }
      this.returnToHand(v); return;
    }
    if (this.targeting?.kind === 'card') {
      const t = this.targetAt(p);
      if (t && this.targeting.targets?.includes(t.unitUid)) { await this.commitTarget(t.unitUid); return; }
      this.cancelTargeting();
      return;
    }
    await this.playCard(v, card, null, null);
  }

  private returnToHand(v: CardView) {
    if (v.parent === this.dragLayer) { this.dragLayer.removeChild(v); this.hand.addChild(v); }
    this.hand.frozen = null;
    this.tray.setAltar(canSacrifice(this.s) && this.s.hand.length ? 'ready' : 'used');
    this.hand.layout(true);
  }

  private async trySacrifice(v: CardView) {
    const card = this.s.hand.find((c) => c.uid === v.cardUid);
    if (!card || !canSacrifice(this.s)) { sfx('deny'); toast('本回合已献过牌', 0xff9a8a, 760); this.returnToHand(v); return; }
    this.clearSelection();
    if (v.parent !== this.dragLayer) { const gp = v.getGlobalPosition(); this.hand.take(v.cardUid); v.parent?.removeChild(v); this.dragLayer.addChild(v); const dp = G.toDesign(gp.x, gp.y); v.position.set(dp.x, dp.y); }
    else this.hand.take(v.cardUid);
    this.hand.frozen = null;
    this.stage = v;
    await this.send({ type: 'sacrifice', card: card.uid });
  }

  private async playCard(v: CardView, card: CardInst, target: number | null, slot: { row: 'front' | 'back'; slot: number } | null) {
    const inWindow = this.s.pending?.kind === 'response';
    this.cancelTargeting(false);
    for (const sg of this.slotGfx) this.drawSlot(sg.g, 'player', sg.row, 'idle');
    if (this.selected) this.hand.lifted.delete(this.selected.cardUid);
    this.selected = null;
    // move card view to stage
    this.hand.take(v.cardUid);
    this.hand.frozen = null;
    if (v.parent !== this.dragLayer) { const gp = v.getGlobalPosition(); v.parent?.removeChild(v); this.dragLayer.addChild(v); const dp = G.toDesign(gp.x, gp.y); v.position.set(dp.x, dp.y); }
    this.stage = v;
    const def = cardDef(card);
    void tweens.to(v, { x: slot ? slotPos('player', slot.row, slot.slot).x : STAGE.x, y: slot ? slotPos('player', slot.row, slot.slot).y : STAGE.y, rotation: 0 }, 160);
    void tweens.to(v.scale, { x: 0.85, y: 0.85 }, 160);
    this.hand.layout(true);
    const a: PlayerAction = inWindow ? { type: 'respond', card: card.uid, target } : { type: 'play', card: card.uid, target, slot };
    if (inWindow) this.closeWindowUi();
    const ok = await this.send(a);
    if (!ok && this.stage === v) { this.stage = null; this.dragLayer.removeChild(v); v.destroy({ children: true }); this.syncAll(); }
    void def;
  }

  // ═════════════ targeting ═════════════

  private startCardTargeting(v: CardView, card: CardInst, fromTap = false) {
    const def = cardDef(card);
    const targets = cardTargets(this.s, 'player', def);
    this.targeting = { kind: 'card', view: v, card, targets, slots: null, response: this.s.pending?.kind === 'response' };
    const gp = fromTap ? v.getGlobalPosition() : null;
    const from = gp ? G.toDesign(gp.x, gp.y - (CARD_H * v.scale.y) / 2) : { x: STAGE.x, y: STAGE.y - 150 };
    this.arrow.show(from.x, from.y);
    this.highlightTargets(targets ?? []);
  }

  private startAttack(attacker: number) {
    const s = this.s;
    const a = unit(s, attacker);
    if (!a || !canAttack(s, a)) return;
    const targets = attackTargets(s, a).map((t) => t.uid);
    if (!targets.length) { toast('没有可攻击的目标', 0xff9a8a, 760); return; }
    this.clearSelection();
    this.targeting = { kind: 'attack', attacker, targets };
    const v = this.units.get(attacker)!;
    this.arrow.show(v.x, v.y + v.topY + 30);
    this.highlightTargets(targets);
    // melee restriction hint: dim unreachable enemies
    for (const e of unitsOf(s, 'enemy', true)) if (!targets.includes(e.uid)) this.units.get(e.uid)?.setHighlight('none');
  }

  private startSkill(i: number) {
    if (this.busy || this.s.phase !== 'main') return;
    const u = skillUsable(this.s, i);
    if (!u.ok) return;
    if (!u.targets) { void this.send({ type: 'skill', skill: i }); return; }
    this.clearSelection();
    this.targeting = { kind: 'skill', index: i, targets: u.targets };
    this.arrow.show(70 + i * 86, 560);
    this.highlightTargets(u.targets);
  }

  private startPotion(slot: number) {
    if (this.busy || (this.s.phase !== 'main')) { toast('现在不能使用'); return; }
    const id = this.s.potions[slot];
    if (!id) return;
    const targets = potionTargets(this.s, slot);
    if (!targets) { void this.send({ type: 'potion', slot }); return; }
    this.clearSelection();
    this.targeting = { kind: 'potion', slot, targets };
    this.arrow.show(560 + slot * 80, 60);
    this.highlightTargets(targets);
  }

  private highlightTargets(ids: number[]) {
    for (const [uid, v] of this.units) v.setHighlight(ids.includes(uid) ? 'target' : 'none');
  }

  private aim(p: { x: number; y: number }) {
    const t = this.targeting;
    if (!t) return;
    this.arrow.to = p;
    const u = this.targetAt(p);
    const valid = !!u && ((t.kind === 'card' ? t.targets ?? [] : t.targets).includes(u.unitUid));
    this.arrow.state = u ? (valid ? 'valid' : 'invalid') : 'neutral';
    for (const [uid, v] of this.units) {
      const list = t.kind === 'card' ? t.targets ?? [] : t.targets;
      v.setHighlight(u && uid === u.unitUid ? (valid ? 'hover' : 'danger') : list.includes(uid) ? 'target' : 'none');
    }
    this.previewDamage(u && valid ? u : null);
  }

  private previewTip: Container | null = null;
  private previewDamage(u: UnitView | null) {
    this.previewTip?.destroy({ children: true });
    this.previewTip = null;
    const t = this.targeting;
    if (!u || !t) return;
    const target = unit(this.s, u.unitUid);
    if (!target) return;
    let dmg: number | null = null;
    let back = 0;
    if (t.kind === 'card') dmg = predictCardDamage(this.s, t.card, target);
    if (t.kind === 'attack') {
      const a = unit(this.s, t.attacker)!;
      dmg = calcDamage(this.s, a, target, atkOf(this.s, a), 'attack');
      if (target.kind === 'unit' && !isRangedAttacker(this.s, a)) back = calcDamage(this.s, target, a, atkOf(this.s, target), 'retaliate');
    }
    if (dmg === null) return;
    const after = Math.max(0, target.hp - Math.max(0, dmg - target.armor));
    const c = new Container();
    const txt = new Text({ text: `-${dmg}${after <= 0 ? ' ☠' : ''}${back ? `  反击 -${back}` : ''}`, style: { fontFamily: FONT_NUM, fontSize: 24, fontWeight: 'bold', fill: after <= 0 ? 0xff5a4a : 0xffe0a0, stroke: { color: 0, width: 5 } } });
    txt.anchor.set(0.5);
    const bg = nine('panel_row', txt.width + 40, 44);
    bg.position.set(-(txt.width + 40) / 2, -22);
    c.addChild(bg, txt);
    c.position.set(u.x, u.y + u.bottomY + 40);
    this.sigLayer.addChild(c);
    this.previewTip = c;
  }

  private async commitTarget(uid: number) {
    const t = this.targeting;
    if (!t) return;
    this.previewTip?.destroy({ children: true }); this.previewTip = null;
    if (t.kind === 'card') { await this.playCard(t.view, t.card, uid, null); return; }
    this.cancelTargeting(false);
    if (t.kind === 'attack') await this.send({ type: 'attack', attacker: t.attacker, target: uid });
    if (t.kind === 'skill') await this.send({ type: 'skill', skill: t.index, target: uid });
    if (t.kind === 'potion') await this.send({ type: 'potion', slot: t.slot, target: uid });
  }

  private cancelTargeting(returnCard = true) {
    const t = this.targeting;
    this.targeting = null;
    this.arrow.hide();
    this.previewTip?.destroy({ children: true }); this.previewTip = null;
    for (const v of this.units.values()) v.setHighlight('none');
    if (t?.kind === 'card' && returnCard) this.returnToHand(t.view);
  }

  private targetAt(p: { x: number; y: number }): UnitView | null {
    for (const v of this.units.values()) {
      const r = v.hitRect();
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return v;
    }
    // forgiving aim: while targeting, snap to the nearest legal target within reach of the pointer
    const legal = this.targeting?.targets;
    if (!legal?.length) return null;
    let best: UnitView | null = null, bd = 120;
    for (const uid of legal) {
      const v = this.units.get(uid);
      if (!v) continue;
      const r = v.hitRect();
      const d = Math.hypot(p.x - (r.x + r.w / 2), p.y - (r.y + r.h / 2)) - Math.min(r.w, r.h) / 2;
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  private slotAt(p: { x: number; y: number }) {
    for (const sg of this.slotGfx) if (Math.abs(p.x - sg.x) < 70 && Math.abs(p.y - sg.y) < 75) return { row: sg.row, slot: sg.slot };
    return null;
  }

  private hoverSlot(p: { x: number; y: number }) {
    const sl = this.slotAt(p);
    for (const sg of this.slotGfx) {
      const empty = emptySlots(this.s, 'player', sg.row).includes(sg.slot);
      this.drawSlot(sg.g, 'player', sg.row, !empty ? 'full' : sl && sl.row === sg.row && sl.slot === sg.slot ? 'hover' : 'drop');
    }
  }

  // ═════════════ input: units ═════════════

  private onUnitHover(v: UnitView, e: FederatedPointerEvent) {
    if (this.targeting || this.dragging) return;
    const u = unit(this.s, v.unitUid);
    if (!u) return;
    const lines: { title?: string; body: string; color?: number }[] = [];
    if (u.origin === 'enemy') {
      const def = content().enemy(u.def);
      const pv = intentPreview(this.s, u);
      lines.push({ title: def.name, body: `攻击 ${atkOf(this.s, u)} · 生命 ${u.hp}` });
      if (pv) {
        const tgt = unit(this.s, pv.target);
        lines.push({ title: `意图：${pv.name}`, body: `${pv.damage !== undefined ? `造成 ${pv.damage}${(pv.hits ?? 1) > 1 ? `×${pv.hits}` : ''} 点伤害` : ''}${pv.armor ? ` 获得 ${pv.armor} 护甲` : ''}${pv.statuses.length ? ` 施加 ${pv.statuses.map((x) => `${STATUSES[x.status as keyof typeof STATUSES]?.name ?? x.status}${x.amount}`).join('、')}` : ''}${tgt ? `\n目标：${tgt.name}` : ''}` || '行动' });
      }
      const kws = def.keywords ?? [];
      lines.push(...glossLines(kws.map((k) => (content().enemies.get(u.def), k)).map((k) => keywordName(k))));
      if (def.passives?.length || def.lore) lines.push({ body: def.lore, color: C.textDim });
    } else if (u.kind === 'unit') {
      const def = content().card(u.def, u.up);
      lines.push({ title: def.name, body: def.text });
      lines.push(...glossLines(termsOf(def.text)));
    } else {
      const cmd = content().commanders.get(u.def);
      lines.push({ title: cmd?.name ?? u.name, body: `生命 ${u.hp}/${u.baseMaxHp}${u.armor ? ` · 护甲 ${u.armor}` : ''}` });
    }
    for (const [id, n] of Object.entries(u.statuses)) { const st = STATUSES[id as keyof typeof STATUSES]; if (st && n) lines.push({ title: `${st.name} ${n}`, body: st.text, color: st.tint }); }
    for (const d of u.delays) { const dd = content().card(d.card, d.up); lines.push({ title: `延时：${dd.name}（${d.turns}）`, body: dd.text, color: 0xf0d27a }); }
    const leftSide = v.x > 960;
    showTip(new Tooltip(lines, 380), leftSide ? v.x - v.bw / 2 - 20 : v.x + v.bw / 2 + 20, Math.max(140, v.y + v.topY), leftSide ? 'left' : 'right');
    // show intent target arc
    if (u.side === 'enemy' && u.intent?.target != null) {
      const tv = this.units.get(u.intent.target);
      if (tv) { tv.setHighlight('danger'); }
    }
  }

  private onUnitOut(v: UnitView) {
    hideTip();
    if (this.targeting) return;
    for (const x of this.units.values()) x.setHighlight('none');
    void v;
  }

  private onUnitDown(v: UnitView, e: FederatedPointerEvent) {
    if (this.busy || this.s.phase !== 'main' || this.s.pending) return;
    if (e.button === 2) return;
    const u = unit(this.s, v.unitUid);
    if (!u || u.side !== 'player') return;
    if (this.targeting) return;
    if (!canAttack(this.s, u)) { if (u.kind === 'unit' || this.s.sides.player.equip.weapon) this.explainNoAttack(u); return; }
    this.startAttack(u.uid);
    this.attackDragging = true;
    this.attackStart = G.toDesign(e.global.x, e.global.y);
  }

  private explainNoAttack(u: Unit) {
    const s = this.s;
    let why = '无法攻击';
    if ((u.statuses.freeze ?? 0) > 0) why = '被冰冻，无法攻击';
    else if ((u.statuses.stun ?? 0) > 0) why = '被眩晕';
    else if (u.kind === 'unit' && u.enteredTurn === s.turn) why = '入场当回合不能攻击（除非[疾行]）'.replace(/\[|\]/g, '');
    else if (u.kind === 'unit' && u.row === 'back') why = '后阵近战单位不能攻击';
    else if (atkOf(s, u) <= 0) why = '攻击力为 0';
    else if (u.attacks > 0) why = '本回合已攻击过';
    toast(why, 0xff9a8a, 760);
  }

  private async onUnitTap(v: UnitView, e: FederatedPointerEvent) {
    if (e.button === 2) { const u = unit(this.s, v.unitUid); if (u?.origin === 'card' || u?.origin === 'token') inspectCard(u.def, u.up); return; }
    const t = this.targeting;
    if (t) {
      const list = t.kind === 'card' ? t.targets ?? [] : t.targets;
      if (list.includes(v.unitUid)) await this.commitTarget(v.unitUid);
      else if (t.kind === 'attack' && t.attacker === v.unitUid) { /* keep */ }
      else { sfx('deny'); }
    }
  }

  private onBackgroundDown(e: FederatedPointerEvent) {
    if (e.button === 2) { this.cancelTargeting(); this.clearSelection(); return; }
    if (this.dragging) return;
    // tap on an empty slot while a unit card is selected
    if (this.selected) {
      const p = G.toDesign(e.global.x, e.global.y);
      const card = this.s.hand.find((c) => c.uid === this.selected!.cardUid);
      if (card && cardDef(card).type === 'unit') {
        const sl = this.slotAt(p);
        if (sl && emptySlots(this.s, 'player', sl.row).includes(sl.slot)) { void this.playCard(this.selected, card, null, sl); return; }
      }
    }
    // any other click on empty space drops the current selection / aim
    if (this.selected || this.targeting) { this.cancelTargeting(); this.clearSelection(); }
  }

  private onKeyDown(e: KeyboardEvent): boolean {
    if (G.modalLayer.children.length) return false;
    if (e.key === ' ' || e.key === 'e' || e.key === 'E') {
      if (this.s.pending?.kind === 'response') { void this.passWindow(); return true; }
      void this.endTurn();
      return true;
    }
    if (e.key === 'Escape') {
      if (this.targeting || this.selected) { this.cancelTargeting(); this.clearSelection(); return true; }
      void import('../settings').then((m) => m.openSettings());
      return true;
    }
    if (e.key === 'd' || e.key === 'D') { openDeck(session.run!.deck, '牌组'); return true; }
    if (e.key === 'l' || e.key === 'L') { this.showLog(); return true; }
    if (e.key === 'a' || e.key === 'A') { openDeck(sortCards(this.s.draw.map((c) => ({ id: c.id, up: c.up }))), '抽牌堆'); return true; }
    if (e.key === 's' || e.key === 'S') { openDeck(this.s.discard.map((c) => ({ id: c.id, up: c.up })), '弃牌堆', { sort: false }); return true; }
    const n = Number(e.key);
    if (!Number.isNaN(n) && e.key !== ' ') {
      const i = n === 0 ? 9 : n - 1;
      const v = this.hand.views[i];
      if (v) this.onCardTap(v);
      return true;
    }
    return false;
  }

  // ═════════════ event playback ═════════════

  private async play(events: CEvent[]) {
    const fast = tweens.skip;
    for (let i = 0; i < events.length; i++) {
      const e = events[i]!;
      if (this.pendingReturn && !['damage', 'status', 'ward', 'death', 'keyword', 'heal', 'stats', 'armor', 'log', 'relic'].includes(e.t)) await this.returnAttacker();
      await this.playOne(e, fast);
    }
    if (this.pendingReturn) await this.returnAttacker();
  }

  private async returnAttacker() {
    const v = this.pendingReturn!;
    this.pendingReturn = null;
    const u = this.s.units[v.unitUid];
    if (!u || v.destroyed) return;
    const p = slotPos(u.side, u.row, u.slot);
    await v.returnTo(p.x, p.y);
  }

  private posOf(uid: number | null | undefined) {
    const v = uid == null ? null : this.units.get(uid);
    if (v) return { x: v.x, y: v.y + (v.mode === 'figure' ? -40 : v.mode === 'token' ? 0 : -60) };
    return { x: 960, y: 450 };
  }

  private async playOne(e: CEvent, fast: boolean) {
    const s = this.s;
    switch (e.t) {
      case 'turn': {
        await this.turnBanner(e.side === 'player' ? '我 方 回 合' : '敌 方 回 合', e.side === 'player' ? 0xffd27a : 0xff8a6a);
        sfx(e.side === 'player' ? 'turnPlayer' : 'turnEnemy');
        this.refreshPlayable();
        this.hand.layout(true);
        break;
      }
      case 'draw': {
        const live = liveCard(s, e.card);
        const v = this.hand.add(e.card, live, { x: PILES.draw.x, y: PILES.draw.y });
        v.scale.set(0.25);
        this.drawPile.set(Math.max(0, Number(this.drawPileCount()) - 1));
        sfx('draw');
        this.hand.layout(true, 250);
        await wait(fast ? 20 : 80);
        break;
      }
      case 'drawFail': toast(e.reason === 'handFull' ? '手牌已满' : '牌库已空', 0xff9a8a, 760); break;
      case 'shuffle': {
        sfx('shuffle');
        for (let k = 0; k < Math.min(8, e.n); k++) {
          const b = new CardView({ id: s.draw[0]?.id ?? s.hand[0]?.id ?? 'n_x', up: false });
          if (!content().cards.has(b.cardId)) break;
          b.setFaceDown(true);
          b.scale.set(0.3);
          b.position.set(PILES.discard.x, PILES.discard.y);
          this.dragLayer.addChild(b);
          void tweens.to(b, { x: PILES.draw.x, y: PILES.draw.y, rotation: -1 }, 320, { delay: k * 30 }).then(() => b.destroy({ children: true }));
        }
        this.discardPile.set(0);
        await wait(fast ? 50 : 300);
        this.drawPile.set(e.n);
        break;
      }
      case 'discard': {
        const v = this.hand.take(e.card.uid) ?? this.takeStage(e.card.uid);
        sfx('discard');
        if (v) this.flyTo(v, PILES.discard, 0.25).then(() => this.discardPile.bump());
        this.hand.layout(true);
        await wait(fast ? 10 : 40);
        break;
      }
      case 'exhaust': {
        const v = this.hand.take(e.card.uid) ?? this.takeStage(e.card.uid);
        if (v) { if (v.parent !== this.dragLayer) this.reparent(v, this.dragLayer); void dissolve(v, 420).then(() => v.destroy({ children: true })); }
        this.hand.layout(true);
        await wait(fast ? 20 : 120);
        break;
      }
      case 'create': {
        if (e.to === 'hand') {
          const v = this.hand.add(e.card, liveCard(s, e.card), { x: 960, y: 540 });
          v.scale.set(0.9);
          await wait(fast ? 40 : 220);
          this.hand.layout(true, 260);
        } else {
          const v = new CardView(e.card);
          v.position.set(960, 520); v.scale.set(0.2);
          this.dragLayer.addChild(v);
          await tweens.to(v.scale, { x: 0.8, y: 0.8 }, fast ? 60 : 200, { ease: ease.outBack });
          await wait(fast ? 40 : 250);
          await this.flyTo(v, e.to === 'draw' ? PILES.draw : PILES.discard, 0.25);
        }
        break;
      }
      case 'sacrifice': {
        const v = this.takeStage(e.card.uid) ?? this.hand.take(e.card.uid);
        sfx('sacrifice');
        if (v) {
          if (v.parent !== this.dragLayer) this.reparent(v, this.dragLayer);
          await Promise.all([tweens.to(v, { x: ALTAR.x, y: ALTAR.y - 20, rotation: 0 }, 220), tweens.to(v.scale, { x: 0.5, y: 0.5 }, 220)]);
          await tweens.to(v.scale, { x: 0, y: 0.5 }, 140);
          v.setFaceDown(true);
          await tweens.to(v.scale, { x: 0.5, y: 0.5 }, 140);
          const gi = e.gained ? s.sources.length - 1 : 0;
          const gp = this.tray.gemPos(Math.max(0, gi));
          await Promise.all([tweens.to(v, { x: gp.x, y: gp.y }, 260, { ease: ease.inCubic }), tweens.to(v.scale, { x: 0.08, y: 0.08 }, 260)]);
          this.fxLayer.burst(gp.x, gp.y, { tex: fxTexture('spark'), n: 18, speed: [80, 240], life: [0.3, 0.7], tint: [0xffd27a, 0xff8a3a], scale: [0.15, 0.3], blend: 'add' });
          v.destroy({ children: true });
        }
        this.tray.sync(s);
        this.tray.setAltar('used');
        this.hand.layout(true);
        break;
      }
      case 'sources': this.tray.sync(s); break;
      case 'embers': {
        if (e.count > 0) { floatText(this.numLayer, `余烬 ×${e.count}`, END_BTN.x + 110, END_BTN.y - 10, { color: 0xffa04a, size: 30 }); sfx('ember'); await wait(fast ? 50 : 350); }
        break;
      }
      case 'play': {
        if (e.side === 'enemy') await this.enemyPlays(e.card, fast);
        else {
          const d = cardDef(e.card);
          if (d.rarity === 'legendary') await this.legendaryShow(e.card);
          sfx(d.type === 'unit' ? 'play' : d.type === 'response' ? 'playResponse' : d.type === 'equip' ? 'playEquip' : d.type === 'delay' ? 'playDelay' : d.type === 'field' ? 'playField' : 'play');
          this.addLog(`打出【${d.name}】`);
          const v = this.stage;
          if (v && d.type !== 'unit') { await Promise.all([tweens.to(v, { x: STAGE.x, y: STAGE.y - 40 }, fast ? 60 : 160), tweens.to(v.scale, { x: 0.95, y: 0.95 }, 160)]); }
        }
        break;
      }
      case 'response': {
        const d = cardDef(e.card);
        this.addLog(`应对【${d.name}】`);
        sfx('playResponse');
        await this.bigText('应！', 0xff6a4a, fast ? 200 : 500);
        break;
      }
      case 'cardDone': {
        const v = this.takeStage(e.card.uid) ?? (this.enemyStage?.cardUid === e.card.uid ? this.enemyStage : null);
        if (this.enemyStage === v) this.enemyStage = null;
        if (!v) break;
        if (e.to === 'discard') { await this.flyTo(v, PILES.discard, 0.25); this.discardPile.bump(); }
        else if (e.to === 'exhaust') { void dissolve(v, 420).then(() => v.destroy({ children: true })); }
        else { await tweens.to(v, { alpha: 0 }, fast ? 60 : 180); v.destroy({ children: true }); }
        break;
      }
      case 'summon': {
        const u = s.units[e.unit.uid];
        if (!u) break;
        const v = this.ensureUnit(u);
        const p = slotPos(u.side, e.unit.row, e.unit.slot);
        v.sync(s, u);
        v.setNumbers(e.unit.hp, e.unit.maxHp, e.unit.atk, e.unit.armor, u);
        // the played card view collapses into the token
        const stage = this.stage;
        if (e.fromCard && stage) { this.stage = null; void Promise.all([tweens.to(stage.scale, { x: 0.3, y: 0.3 }, 180), tweens.to(stage, { x: p.x, y: p.y, alpha: 0 }, 180)]).then(() => stage.destroy({ children: true })); }
        v.position.set(p.x, p.y - 120);
        v.alpha = 0;
        v.scale.set(1.15);
        const legendary = u.origin === 'card' && content().card(u.def).rarity === 'legendary';
        await Promise.all([tweens.to(v, { y: p.y, alpha: 1 }, fast ? 80 : 200, { ease: ease.inQuad }), tweens.to(v.scale, { x: 1, y: 1 }, fast ? 80 : 200)]);
        sfx(u.side === 'enemy' ? 'summon' : 'playUnit');
        this.fxLayer.burst(p.x, p.y + v.bottomY, { tex: fxTexture('smoke'), n: 10, speed: [40, 140], life: [0.4, 0.9], angle: -Math.PI / 2, spread: Math.PI, tint: 0x8a7a6a, scale: [0.2, 0.45], scaleEnd: 1.4 });
        if (legendary) { void shake(this.shakeRoot, 10, 300, session.settings.screenShake); this.fxLayer.burst(p.x, p.y, { tex: fxTexture('spark'), n: 30, speed: [150, 420], life: [0.5, 1.1], tint: [0xffd27a, 0xffffff], blend: 'add' }); }
        else void shake(this.shakeRoot, 3, 140, session.settings.screenShake);
        break;
      }
      case 'move': {
        const v = this.units.get(e.uid);
        const u = s.units[e.uid];
        if (v && u) { const p = slotPos(u.side, e.row, e.slot); await tweens.to(v, { x: p.x, y: p.y }, fast ? 80 : 240, { ease: ease.inOutCubic }); }
        break;
      }
      case 'attack': {
        const a = this.units.get(e.attacker), t = this.units.get(e.target);
        if (!a || !t) break;
        const u = s.units[e.attacker];
        const ranged = u && (isRangedAttacker(s, u));
        if (ranged) {
          const pr = new Sprite(fxTexture('glow'));
          pr.anchor.set(0.5); pr.blendMode = 'add'; pr.scale.set(0.35); pr.tint = u.side === 'player' ? 0xffd27a : 0xff6a4a;
          const from = this.posOf(e.attacker), to = this.posOf(e.target);
          pr.position.set(from.x, from.y);
          this.fxLayer.addChild(pr);
          await tweens.to(pr, { x: to.x, y: to.y }, fast ? 80 : 200, { ease: ease.inQuad });
          pr.destroy();
        } else {
          const to = this.posOf(e.target);
          await a.lunge(to.x, to.y);
          this.pendingReturn = a;
        }
        break;
      }
      case 'damage': await this.onDamage(e, fast); break;
      case 'heal': {
        const v = this.units.get(e.target);
        if (v && e.amount > 0) { floatText(this.numLayer, `+${e.amount}`, v.x, v.y + v.topY + 20, { color: 0x6fe08a }); sfx('heal'); this.fxLayer.burst(v.x, v.y, { tex: fxTexture('glow'), n: 8, speed: [20, 80], life: [0.5, 1], angle: -Math.PI / 2, spread: 1, tint: 0x8aff9a, blend: 'add', scale: [0.1, 0.2] }); }
        this.updateUnitNumbers(e.target);
        break;
      }
      case 'armor': {
        const v = this.units.get(e.target);
        if (v && e.amount > 0) { floatText(this.numLayer, `+${e.amount}护甲`, v.x, v.y + v.topY + 20, { color: 0x9ac8ff, size: 32 }); sfx('armor'); }
        this.updateUnitNumbers(e.target);
        break;
      }
      case 'ward': { const v = this.units.get(e.target); if (v) v.setWard(e.ward); break; }
      case 'status': {
        const v = this.units.get(e.target);
        const u = s.units[e.target];
        if (v && u) {
          v.setStatuses(currentStatusesPartial(v, u, e.status, e.total));
          if (e.delta > 0) {
            const st = STATUSES[e.status];
            floatText(this.numLayer, `${st.name}${e.status === 'stun' || e.status === 'silence' ? '' : ` ${e.delta}`}`, v.x, v.y + v.topY + 40, { color: st.tint, size: 28 });
            sfx(e.status === 'burn' ? 'burn' : e.status === 'poison' ? 'poison' : e.status === 'freeze' ? 'freeze' : e.status === 'stun' ? 'stun' : st.debuff ? 'debuff' : 'buff');
            await wait(fast ? 10 : 90);
          }
        }
        break;
      }
      case 'stats': { const v = this.units.get(e.target); const u = s.units[e.target]; if (v && u) v.setNumbers(e.hp, e.maxHp, e.atk, u.armor, u); break; }
      case 'keyword': {
        const v = this.units.get(e.target);
        if (v) { void (async () => { await tweens.to(v.scale, { x: 1.08, y: 1.08 }, 90); await tweens.to(v.scale, { x: 1, y: 1 }, 140); })(); }
        break;
      }
      case 'death': {
        const v = this.units.get(e.uid);
        if (!v) break;
        this.units.delete(e.uid);
        sfx('death');
        const u = s.units[e.uid];
        this.addLog(`${u?.name ?? ''} 倒下`);
        this.fxLayer.burst(v.x, v.y, { tex: fxTexture('ink_splash'), n: 8, speed: [60, 200], life: [0.4, 0.9], tint: 0x1a1210, scale: [0.2, 0.5], scaleEnd: 1.2 });
        void dissolve(v, fast ? 200 : 520, u?.side === 'enemy' ? [0.6, 0.9, 1.0] : [1.0, 0.6, 0.2]).then(() => v.destroy({ children: true }));
        await wait(fast ? 30 : 160);
        break;
      }
      case 'intent': { const v = this.units.get(e.uid); const u = s.units[e.uid]; if (v && u) { v.setIntent(s, u); v.intentBox.alpha = 0; void tweens.to(v.intentBox, { alpha: 1 }, 200); } break; }
      case 'declare': await this.onDeclare(e, fast); break;
      case 'window': if (!e.open) this.closeWindowUi(); break;
      case 'cancel': await this.bigText(e.what === 'move' ? '行动被化解！' : '被取消！', 0x9ad8ff, fast ? 200 : 600); break;
      case 'redirect': await this.bigText('目标转移！', 0xffd27a, fast ? 150 : 450); break;
      case 'judgeFlip': {
        const reason = this.judgeReason();
        this.judgeView = await this.fate.judgeFlip(this.sigLayer, e.card, reason, this.fxLayer, fast || session.settings.fastJudge);
        this.addLog(`判定：${SUIT_INFO[e.card.suit].name} ${e.card.rank}`);
        break;
      }
      case 'rejudge': {
        if (this.judgeView) this.judgeView = await this.fate.rejudge(this.sigLayer, this.judgeView, e.now, this.fxLayer);
        this.addLog(`改判为 ${SUIT_INFO[e.now.suit].name} ${e.now.rank}`);
        this.fate.sync(s);
        break;
      }
      case 'judgeResult': {
        if (this.judgeView) { const v = this.judgeView; this.judgeView = null; await this.fate.resultAndDiscard(v, e.branch, fast || session.settings.fastJudge); }
        this.fate.sync(s);
        break;
      }
      case 'fate': this.fate.sync(s); if (e.action === 'shuffle') sfx('shuffle'); break;
      case 'delay': {
        const v = this.units.get(e.target);
        sfx('playDelay');
        if (v) { const u = s.units[e.target]; if (u) v.setDelays(u.delays.map((d) => ({ card: d.card, turns: d.turns }))); floatText(this.numLayer, `延时 ${e.turns}`, v.x, v.y + v.bottomY + 30, { color: 0xf0d27a, size: 26 }); }
        await wait(fast ? 20 : 200);
        break;
      }
      case 'delayTick': { const v = this.units.get(e.target); const u = s.units[e.target]; if (v && u) v.setDelays(u.delays.map((d) => ({ card: d.card, turns: d.turns }))); break; }
      case 'equip': this.pEquip.sync(s); this.eEquip.sync(s); if (e.card) sfx('playEquip'); break;
      case 'weapon': this.pEquip.sync(s); this.eEquip.sync(s); break;
      case 'field': this.pField.sync(s); this.eField.sync(s); break;
      case 'skill': {
        const sk = s.skills[e.index];
        const def = sk ? skillDef(s, sk) : undefined;
        if (def) { await this.turnBanner(`${def.name}`, 0xffd27a, 0.6); this.addLog(`发动【${def.name}】`); }
        this.skills.sync(s);
        break;
      }
      case 'relic': this.top.pulseRelic(e.id); sfx('relic'); break;
      case 'phaseChange': await this.phaseCeremony(e.uid, e.name, e.text); break;
      case 'stunned': { const v = this.units.get(e.uid); if (v) floatText(this.numLayer, '眩晕！', v.x, v.y + v.topY, { color: 0xf5e16a }); sfx('stun'); await wait(fast ? 50 : 350); break; }
      case 'frozen': { const v = this.units.get(e.uid); if (v) floatText(this.numLayer, '冰封！', v.x, v.y + v.topY, { color: 0x9ad8ff }); sfx('freeze'); await wait(fast ? 50 : 350); break; }
      case 'log': this.addLog(e.text); this.actionBanner(e.text); break;
      case 'potion': this.top.refresh(); sfx('heal'); break;
      case 'end': break;
    }
  }

  private drawPileCount() { return (this.drawPile.children.find((c) => c instanceof Text) as Text | undefined)?.text ?? '0'; }

  private takeStage(uid: number): CardView | null {
    if (this.stage && this.stage.cardUid === uid) { const v = this.stage; this.stage = null; return v; }
    for (const c of this.dragLayer.children) if (c instanceof CardView && c.cardUid === uid) return c;
    return null;
  }

  private reparent(v: Container, to: Container) {
    const gp = v.getGlobalPosition();
    v.parent?.removeChild(v);
    to.addChild(v);
    const dp = G.toDesign(gp.x, gp.y);
    v.position.set(dp.x, dp.y);
  }

  private async flyTo(v: CardView, p: { x: number; y: number }, scale: number) {
    if (v.parent !== this.dragLayer) this.reparent(v, this.dragLayer);
    await Promise.all([tweens.to(v, { x: p.x, y: p.y, rotation: 0.6 }, 260, { ease: ease.inCubic }), tweens.to(v.scale, { x: scale, y: scale }, 260)]);
    v.destroy({ children: true });
  }

  private updateUnitNumbers(uid: number) {
    const v = this.units.get(uid), u = this.s.units[uid];
    if (v && u) v.setNumbers(u.hp, v.shown.maxHp || u.baseMaxHp, v.shown.atk, u.armor, u);
    if (u?.kind === 'commander' && u.side === 'player') this.top.refresh();
  }

  private async onDamage(e: Extract<CEvent, { t: 'damage' }>, fast: boolean) {
    const v = this.units.get(e.target);
    if (!v) return;
    const u = this.s.units[e.target];
    const big = e.amount >= 15;
    if (e.warded) {
      sfx('wardBreak');
      floatText(this.numLayer, '灵障', v.x, v.y + v.topY + 20, { color: 0xffe8a0, size: 34 });
      this.fxLayer.burst(v.x, v.y, { tex: fxTexture('spark'), n: 20, speed: [120, 300], life: [0.3, 0.7], tint: 0xffe8a0, blend: 'add' });
      return;
    }
    const col = e.kind === 'burn' ? 0xff8a3a : e.kind === 'poison' ? 0x8fd35a : e.kind === 'loss' ? 0xd07ae0 : e.hpLoss === 0 ? 0x9ac8ff : 0xffffff;
    if (session.settings.damageNumbers) floatText(this.numLayer, e.hpLoss === 0 && e.armorLoss > 0 ? `-${e.armorLoss}` : `-${e.amount}`, v.x, v.y + v.topY + 10, { color: col, big });
    if (e.kind === 'attack' || e.kind === 'retaliate' || e.kind === 'effect' || e.kind === 'thorns') {
      sfx(e.armorLoss > 0 && e.hpLoss === 0 ? 'block' : big ? 'hitHeavy' : 'hit', Math.min(1.5, 0.6 + e.amount / 20));
      this.fxLayer.burst(v.x, v.y - 20, { tex: fxTexture('slash'), n: 1, speed: [0, 0], life: [0.18, 0.22], tint: 0xffffff, blend: 'add', scale: [1.2, 1.4], scaleEnd: 1.3 });
      this.fxLayer.burst(v.x, v.y - 20, { tex: fxTexture('spark'), n: big ? 22 : 10, speed: [120, 380], life: [0.25, 0.6], tint: [0xffe0a0, 0xffffff], blend: 'add', scale: [0.12, 0.28] });
      if (big && !fast) await hitStop(80);
      void v.hitReact(u?.side === 'enemy' ? 1 : -1);
      if (e.target === this.s.sides.player.commander || big) void shake(this.shakeRoot, big ? 12 : 6, big ? 320 : 180, session.settings.screenShake);
    } else if (e.kind === 'burn') { sfx('burn'); this.fxLayer.burst(v.x, v.y, { tex: fxTexture('flame'), n: 8, speed: [40, 120], life: [0.4, 0.8], angle: -Math.PI / 2, spread: 1.2, blend: 'add', scale: [0.15, 0.3] }); }
    else if (e.kind === 'poison') { sfx('poison'); this.fxLayer.burst(v.x, v.y, { tex: fxTexture('glow'), n: 10, speed: [30, 90], life: [0.4, 0.9], tint: 0x8fd35a, blend: 'add', scale: [0.1, 0.2] }); }
    if (u) v.setNumbers(e.hp, v.shown.maxHp || u.baseMaxHp, v.shown.atk, e.armor, u);
    if (u?.kind === 'commander' && u.side === 'player') this.top.refresh();
    await wait(fast ? 10 : 60);
  }

  private async onDeclare(e: Extract<CEvent, { t: 'declare' }>, fast: boolean) {
    const s = this.s;
    const a = this.units.get(e.uid);
    const u = s.units[e.uid];
    if (!a || !u) return;
    const def = content().enemy(u.def);
    const mv = { ...def.moves, ...(u.phase ? def.phases?.[u.phase - 1]?.moves ?? {} : {}) }[e.move];
    const tgt = e.target != null ? s.units[e.target] : null;
    const pv = intentPreview(s, u);
    sfx('declare');
    void (async () => { await tweens.to(a.intentBox.scale, { x: 1.3, y: 1.3 }, 120); await tweens.to(a.intentBox.scale, { x: 1, y: 1 }, 200); })();
    const txt = `【${u.name}】${mv?.name ?? ''}${tgt ? ` → ${tgt.name}` : ''}${pv?.damage !== undefined ? ` · ${pv.damage}${(pv.hits ?? 1) > 1 ? `×${pv.hits}` : ''} 伤害` : ''}`;
    this.addLog(txt);
    this.declareBanner(txt);
    if (tgt) { const tv = this.units.get(tgt.uid); tv?.setHighlight('danger'); }
    await wait(fast ? 80 : 450);
    for (const v of this.units.values()) v.setHighlight('none');
  }

  // ═════════════ ceremonies & banners ═════════════

  private async intro() {
    const s = this.s;
    const boss = unit(s, s.sides.enemy.commander);
    const enc = content().encounters.get(s.cfg.encounter);
    if (boss && enc?.tier === 'boss') {
      const def = content().enemy(boss.def);
      sfx('bossIntro');
      const ov = new Container();
      ov.addChild(dim(1920, 1080, 0.8));
      const tex = assets.get(K.enemy(boss.def, true));
      if (tex) { const sp = new Sprite(tex); sp.anchor.set(0.5, 1); sp.scale.set(Math.min(900 / tex.height, 1)); sp.position.set(1300, 1040); sp.alpha = 0; ov.addChild(sp); void tweens.to(sp, { alpha: 1, x: 1250 }, 700); }
      const nm = title(def.name, 110);
      nm.anchor.set(0.5); nm.position.set(620, 420);
      const line = new Text({ text: def.dialogue?.intro ?? '', style: { fontFamily: FONT_BODY, fontSize: 30, fill: C.text, wordWrap: true, wordWrapWidth: 900, lineHeight: 46, stroke: { color: 0, width: 4 }, breakWords: true } });
      line.anchor.set(0.5, 0); line.position.set(620, 540);
      ov.addChild(nm, line);
      ov.alpha = 0;
      this.sigLayer.addChild(ov);
      await tweens.to(ov, { alpha: 1 }, 400);
      void shake(this.shakeRoot, 8, 500, session.settings.screenShake);
      await wait(tweens.skip ? 600 : 2600);
      await tweens.to(ov, { alpha: 0 }, 400);
      ov.destroy({ children: true });
    } else {
      await this.turnBanner(enc?.tier === 'elite' ? '精 英 来 袭' : '遭 遇 敌 人', enc?.tier === 'elite' ? 0xff7a5a : 0xffd27a);
    }
    if (session.run?.tutorial && session.settings.tutorialHints) this.tutorialHints();
  }

  private tutorialHints() {
    const s = this.s;
    const enc = content().encounters.get(s.cfg.encounter);
    const key = enc?.tutorial ?? (session.run!.floor <= 1 ? 'basic' : null);
    if (!key) return;
    const text = key === 'basic'
      ? '• 拖动手牌到战场打出；随从拖到空格子。\n• 每回合可把一张手牌拖到左下「献」台，化为永久的【源】——每张牌既是资源也是出牌。\n• 敌人头顶的图标就是它下回合要做的事，数字已计算完毕。\n• 近战单位只能在前阵攻击，且只能打到对方最前排。'
      : key === 'response'
        ? '• 回合结束时，未用完的源会留下至多 2 枚【余烬】。\n• 带朱红「应」印的牌可以在敌人宣告行动后打出——应对窗口会自动打开。'
        : '• 【判定】会翻开共享的天命牌堆顶：日纹、雷纹为阳，月纹、山纹为阴。\n• 首领会把【延时】牌挂在你身上。持有【命签】时可以改判。';
    const m = new Modal(980, 420, { title: key === 'basic' ? '初入命阙' : key === 'response' ? '应对窗口' : '天命判定' });
    const t = new Text({ text, style: { fontFamily: FONT_BODY, fontSize: 26, fill: C.text, lineHeight: 46, wordWrap: true, wordWrapWidth: 880 } });
    t.position.set(50, 110);
    m.body.addChild(t);
  }

  private async turnBanner(text: string, color: number, scale = 1) {
    const c = new Container();
    const bg = nine('banner_band', 1400 * scale, 130 * scale);
    bg.position.set(-700 * scale, -65 * scale);
    const t = title(text, 64 * scale, { fill: color });
    t.anchor.set(0.5);
    c.addChild(bg, t);
    c.position.set(960, 450);
    c.alpha = 0;
    this.sigLayer.addChild(c);
    t.x = -120;
    await Promise.all([tweens.to(c, { alpha: 1 }, 160), tweens.to(t, { x: 0 }, 260, { ease: ease.outCubic })]);
    await wait(tweens.skip ? 80 : 420);
    await Promise.all([tweens.to(c, { alpha: 0 }, 200), tweens.to(t, { x: 120 }, 200)]);
    c.destroy({ children: true });
  }

  private declareBanner(text: string) {
    this.banner.removeChildren().forEach((c) => c.destroy({ children: true }));
    const t = new Text({ text, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 30, fill: 0xffd8c8, stroke: { color: 0, width: 5 } } });
    t.anchor.set(0.5);
    const bg = nine('banner_band', t.width + 200, 84);
    bg.position.set(-(t.width + 200) / 2, -42);
    const c = new Container();
    c.addChild(bg, t);
    c.position.set(960, 410);
    this.banner.addChild(c);
    c.alpha = 0;
    void tweens.to(c, { alpha: 1 }, 120).then(() => wait(1200)).then(() => tweens.to(c, { alpha: 0 }, 300)).then(() => { if (!c.destroyed) c.destroy({ children: true }); });
  }

  private actionBanner(text: string) {
    const t = new Text({ text, style: { fontFamily: FONT_BODY, fontSize: 22, fill: C.text, stroke: { color: 0, width: 4 } } });
    t.anchor.set(0.5);
    t.position.set(960, 150);
    this.sigLayer.addChild(t);
    void wait(1800).then(() => tweens.to(t, { alpha: 0 }, 300)).then(() => t.destroy());
  }

  private async bigText(text: string, color: number, ms: number) {
    const t = title(text, 90, { fill: color });
    t.anchor.set(0.5);
    t.position.set(960, 470);
    t.scale.set(1.8);
    t.alpha = 0;
    this.sigLayer.addChild(t);
    await Promise.all([tweens.to(t.scale, { x: 1, y: 1 }, 180, { ease: ease.outBack }), tweens.to(t, { alpha: 1 }, 120)]);
    await wait(ms);
    await tweens.to(t, { alpha: 0 }, 200);
    t.destroy();
  }

  private async legendaryShow(card: CardInst) {
    sfx('legendary');
    const ov = new Container();
    ov.addChild(dim(1920, 1080, 0.75));
    const v = new CardView(card);
    v.position.set(960, 520);
    v.scale.set(0.4);
    ov.addChild(v);
    this.sigLayer.addChild(ov);
    this.fxLayer.burst(960, 520, { tex: fxTexture('spark'), n: 60, speed: [200, 700], life: [0.6, 1.4], tint: [0xffd27a, 0xff9a3a, 0xffffff], blend: 'add', scale: [0.2, 0.5] });
    await tweens.to(v.scale, { x: 1.5, y: 1.5 }, 420, { ease: ease.outBack });
    void shake(this.shakeRoot, 10, 400, session.settings.screenShake);
    await wait(tweens.skip ? 300 : 1100);
    await tweens.to(ov, { alpha: 0 }, 300);
    ov.destroy({ children: true });
  }

  private async enemyPlays(card: CardInst, fast: boolean) {
    const d = cardDef(card);
    this.addLog(`敌方打出【${d.name}】`);
    sfx('play');
    const v = new CardView(card);
    v.cardUid = card.uid;
    v.position.set(1750, 600);
    v.scale.set(0.2);
    this.dragLayer.addChild(v);
    await Promise.all([tweens.to(v, { x: 1400, y: 470 }, fast ? 100 : 260, { ease: ease.outCubic }), tweens.to(v.scale, { x: 0.9, y: 0.9 }, fast ? 100 : 260)]);
    this.enemyStage = v;
    await wait(fast ? 150 : 700);
    this.syncBossHand();
  }

  private async phaseCeremony(uid: number, name: string, text: string) {
    sfx('phase');
    void shake(this.shakeRoot, 16, 700, session.settings.screenShake);
    // impact flash from the generated glow effect texture
    const flash = new Sprite(fxTexture('glow'));
    flash.anchor.set(0.5);
    flash.blendMode = 'add';
    flash.width = 2600; flash.height = 1600;
    flash.position.set(960, 540);
    this.sigLayer.addChild(flash);
    await tweens.to(flash, { alpha: 0 }, 400);
    flash.destroy();
    const v = this.units.get(uid);
    if (v) this.fxLayer.burst(v.x, v.y - 100, { tex: fxTexture('ink_splash'), n: 20, speed: [100, 400], life: [0.6, 1.2], tint: 0x1a0a08, scale: [0.3, 0.7] });
    const c = new Container();
    const bg = nine('banner_band', 1600, 240);
    bg.position.set(-800, -120);
    const t = title(name, 72, { fill: 0xff8a6a });
    t.anchor.set(0.5); t.y = -34;
    const l = new Text({ text, style: { fontFamily: FONT_BODY, fontSize: 28, fill: C.text, stroke: { color: 0, width: 4 } } });
    l.anchor.set(0.5); l.y = 50;
    c.addChild(bg, t, l);
    c.position.set(960, 470);
    c.alpha = 0;
    this.sigLayer.addChild(c);
    await tweens.to(c, { alpha: 1 }, 250);
    await wait(tweens.skip ? 500 : 2200);
    await tweens.to(c, { alpha: 0 }, 300);
    c.destroy({ children: true });
    this.addLog(`${name}：${text}`);
    const u = this.s.units[uid];
    if (u) {
      const def = content().enemy(u.def);
      const ph = def.phases?.[(u.phase ?? 1) - 1];
      if (ph?.art) await assets.load(K.enemy(`${def.id}_p${u.phase! + 1}`, true));
    }
  }

  private judgeReason(): string {
    return '天命判定';
  }

  private addLog(t: string) {
    this.logLines.push(`第${this.s.turn}回合 · ${t}`);
    if (this.logLines.length > 200) this.logLines.shift();
  }

  private showLog() {
    const m = new Modal(900, 900, { title: '战报' });
    const t = new Text({ text: this.logLines.slice(-30).join('\n') || '（暂无）', style: { fontFamily: FONT_BODY, fontSize: 20, fill: C.text, lineHeight: 26, wordWrap: true, wordWrapWidth: 820 } });
    t.position.set(40, 100);
    m.body.addChild(t);
  }

  // ═════════════ decisions ═════════════

  private async handlePending() {
    const d = this.s.pending;
    if (!d) return;
    this.syncAll();
    switch (d.kind) {
      case 'response': {
        const mode = session.settings.responseMode;
        const worthwhile = mode === 'always' || (mode === 'smart' && this.responseMatters());
        if (mode === 'never' || !worthwhile) { await this.send({ type: 'pass' }); return; }
        this.openWindowUi(d.actor, d.target);
        return;
      }
      case 'chooseCards': {
        const purpose = { discard: '选择要弃置的牌', exhaust: '选择要燃尽的牌', fetch: '选择要取回的牌', discover: '发现：选择一张加入手牌' }[d.purpose];
        const cards = (d.offer ?? d.cards).map((c) => ({ id: c.id, up: c.up, uid: c.uid }));
        if (d.purpose === 'discover') { this.discoverUi(cards); return; }
        pickCards(cards, { title: purpose, n: d.max, min: d.min, confirm: '确定', onDone: (uids) => void this.send({ type: 'choose', picks: uids }) });
        return;
      }
      case 'chooseOption': {
        const m = new Modal(900, 200 + d.options.length * 100, { title: '抉择', closable: false });
        d.options.forEach((o, i) => {
          const b = new Button(o, { width: 780, height: 80, fontSize: 26, onClick: () => { m.close(); void this.send({ type: 'choose', picks: [i] }); } });
          b.position.set(60, 110 + i * 100);
          m.body.addChild(b);
        });
        return;
      }
      case 'stargaze': this.stargazeUi(d.cards); return;
      case 'rejudge': this.rejudgeUi(d.card, d.signs); return;
    }
  }

  /** smart mode: only ask when a response could change the outcome */
  private responseMatters(): boolean {
    const d = this.s.pending;
    if (!d || d.kind !== 'response') return false;
    const actor = unit(this.s, d.actor);
    if (!actor) return true;
    if (actor.origin !== 'enemy') return true;
    const pv = intentPreview(this.s, actor);
    return !!pv && (pv.damage !== undefined || pv.types.includes('debuff') || pv.types.includes('summon') || pv.types.includes('cast'));
  }

  private openWindowUi(actor: number | null, target: number | null) {
    this.closeWindowUi();
    sfx('window');
    const ui = new Container();
    const dm = dim(1920, 650, 0.35, 0, 128);
    dm.eventMode = 'none';
    ui.addChild(dm);
    const a = unit(this.s, actor);
    const t = unit(this.s, target);
    const pv = a ? intentPreview(this.s, a) : null;
    let msg = `${a?.name ?? '敌方'} 宣告行动${t ? ` → ${t.name}` : ''}`;
    if (pv?.damage !== undefined && t) {
      const total = pv.damage * (pv.hits ?? 1);
      msg += `\n若不应对：${t.name} ${t.hp} → ${Math.max(0, t.hp - Math.max(0, total - t.armor))}`;
    }
    const txt = new Text({ text: msg, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 30, fill: 0xffe0d0, stroke: { color: 0, width: 5 }, align: 'center' } });
    txt.anchor.set(0.5);
    const bh = Math.max(150, txt.height + INSET.dark.y * 2);
    const bw = Math.max(720, txt.width + INSET.dark.x * 2);
    const bg = panel(bw, bh, 'dark');
    bg.position.set(-bw / 2, -bh / 2);
    const box = new Container();
    box.addChild(bg, txt);
    box.position.set(960, 420);
    ui.addChild(box);
    const lbl = new Text({ text: '应 对 窗 口', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 26, fill: 0xff9a7a, letterSpacing: 6 } });
    lbl.anchor.set(0.5); lbl.position.set(960, 340);
    ui.addChild(lbl);
    // countdown ring replaces the end-turn button
    // countdown: a generated ring texture revealed by an invisible sector mask
    const ring = new Container();
    const ringArt = ringSprite('red', 124);
    const ringMask = sectorMask(maskCircle(0, 0, 0), 64, 1);
    ring.addChild(ringArt, ringMask);
    ringArt.mask = ringMask;
    (ring as Container & { sector?: typeof ringMask }).sector = ringMask;
    ring.position.set(END_BTN.x + END_BTN.w / 2, END_BTN.y + END_BTN.h / 2);
    ui.addChild(ring);
    this.sigLayer.addChild(ui);
    this.windowUi = ui;
    (ui as Container & { ring?: Container }).ring = ring;
    this.endBtn.setDisabled(false);
    this.endBtn.setText('不应对');
    this.endBtn.setKind('danger');
    this.endBtn.onClick = () => void this.passWindow();
    this.windowTotal = (session.settings.responseTimer || 0) * 1000 * (G.compact ? 1.25 : 1);
    this.windowTimer = this.windowTotal;
    if (actor != null) this.units.get(actor)?.setHighlight('danger');
    if (target != null) this.units.get(target)?.setHighlight('target');
    this.refreshPlayable();
    this.hand.layout(true);
  }

  private closeWindowUi() {
    if (!this.windowUi) return;
    this.windowUi.destroy({ children: true });
    this.windowUi = null;
    this.endBtn.onClick = () => this.endTurn();
    for (const v of this.units.values()) v.setHighlight('none');
    this.updateEndButton();
  }

  private async passWindow() {
    if (this.s.pending?.kind !== 'response') return;
    this.closeWindowUi();
    this.cancelTargeting();
    this.clearSelection();
    await this.send({ type: 'pass' });
  }

  private discoverUi(cards: { id: string; up: boolean; uid: number }[]) {
    const m = new Modal(1300, 700, { title: '发现', closable: false });
    cards.forEach((c, i) => {
      const v = new CardView(c);
      v.position.set(650 + (i - (cards.length - 1) / 2) * 380, 380);
      v.scale.set(0.95);
      v.eventMode = 'static';
      v.cursor = 'pointer';
      v.on('pointerover', () => void tweens.to(v.scale, { x: 1.03, y: 1.03 }, 100));
      v.on('pointerout', () => void tweens.to(v.scale, { x: 0.95, y: 0.95 }, 100));
      v.on('pointertap', () => { m.close(); void this.send({ type: 'choose', picks: [c.uid] }); });
      m.body.addChild(v);
    });
  }

  private stargazeUi(cards: FateCard[]) {
    const m = new Modal(1300, 640, { title: `观星 · 天命牌堆顶 ${cards.length} 张`, closable: false });
    let top = [...cards];
    let bottom: FateCard[] = [];
    const draw = () => {
      for (const c of [...m.body.children]) if ((c as Container & { tag?: string }).tag === 'row') c.destroy({ children: true });
      const mk = (list: FateCard[], y: number, isTop: boolean) => {
        const row = new Container();
        (row as Container & { tag?: string }).tag = 'row';
        const l = label(isTop ? '牌堆顶 ▶（左侧最先翻开）' : '牌堆底 ▶', { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 24, fill: C.goldLight });
        l.position.set(40, y - 100);
        row.addChild(l);
        list.forEach((c, i) => {
          const v = new FateCardView(c);
          v.position.set(260 + i * 150, y);
          v.eventMode = 'static';
          v.cursor = 'pointer';
          v.on('pointertap', () => {
            // tap: move between rows; shift-order by moving to the front of its row
            if (isTop) { top = top.filter((x) => x !== c); bottom = [...bottom, c]; }
            else { bottom = bottom.filter((x) => x !== c); top = [...top, c]; }
            draw();
          });
          if (isTop && i > 0) {
            const up = new Button('◀', { width: 44, height: 40, fontSize: 18, kind: 'ghost', onClick: () => { const j = top.indexOf(c); [top[j - 1], top[j]] = [top[j]!, top[j - 1]!]; draw(); } });
            up.position.set(-22 - 75, 100);
            v.addChild(up);
          }
          row.addChild(v);
        });
        m.body.addChild(row);
      };
      mk(top, 220, true);
      mk(bottom, 460, false);
    };
    draw();
    const hint = label('点击命牌可在顶/底之间移动；◀ 调整顺序。', { fontSize: 20, fill: C.textDim });
    hint.position.set(40, 570);
    const ok = new Button('确定', { width: 200, height: 64, kind: 'primary', onClick: () => { m.close(); void this.send({ type: 'arrange', top: top.map((c) => c.id), bottom: bottom.map((c) => c.id) }); } });
    ok.position.set(1060, 550);
    m.body.addChild(hint, ok);
  }

  private rejudgeUi(card: FateCard, signs: FateCard[]) {
    const m = new Modal(900, 560, { title: '改判时机', closable: false, dim: 0.4 });
    const cur = new FateCardView(card);
    cur.position.set(200, 280);
    cur.scale.set(1.3);
    m.body.addChild(cur);
    const l = label(`当前判定：${SUIT_INFO[card.suit].name} ${card.rank}`, { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 26, fill: C.goldLight });
    l.position.set(110, 90);
    m.body.addChild(l);
    signs.forEach((c, i) => {
      const v = new FateCardView(c);
      v.position.set(480 + i * 170, 260);
      v.eventMode = 'static';
      v.cursor = 'pointer';
      v.on('pointertap', () => { m.close(); void this.send({ type: 'rejudge', sign: i }); });
      const t = label('改判', { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 22, fill: C.goldLight });
      t.anchor.set(0.5); t.position.set(0, 110);
      v.addChild(t);
      m.body.addChild(v);
    });
    const no = new Button('不改判', { width: 220, height: 64, kind: 'ghost', onClick: () => { m.close(); void this.send({ type: 'rejudge', sign: null }); } });
    no.position.set(560, 450);
    m.body.addChild(no);
  }

  // ═════════════ end of combat ═════════════

  private async finish() {
    if (this.ending) return;
    this.ending = true;
    this.cancelTargeting();
    const win = this.s.over === 'win';
    audio.playMusic(win ? 'victory' : 'defeat');
    sfx(win ? 'victory' : 'defeat');
    const boss = content().encounters.get(this.s.cfg.encounter)?.tier === 'boss';
    const ov = new Container();
    ov.addChild(dim(1920, 1080, 0.65));
    const t = title(win ? (boss ? '首 领 伏 诛' : '大 捷') : '命 数 已 尽', 120, { fill: win ? 0xffd27a : 0xc8a0a0 });
    t.anchor.set(0.5); t.position.set(960, 440); t.scale.set(1.6); t.alpha = 0;
    ov.addChild(t);
    if (win && boss) {
      const bu = Object.values(this.s.units).find((u) => u.side === 'enemy' && u.kind === 'commander');
      const line = bu ? content().enemy(bu.def).dialogue?.defeat : undefined;
      if (line) { const l = new Text({ text: line, style: { fontFamily: FONT_BODY, fontSize: 28, fill: C.text, wordWrap: true, wordWrapWidth: 1100, align: 'center', breakWords: true } }); l.anchor.set(0.5, 0); l.position.set(960, 560); ov.addChild(l); }
    }
    this.sigLayer.addChild(ov);
    if (win) for (let i = 0; i < 4; i++) this.fxLayer.burst(560 + i * 260, 460, { tex: fxTexture('spark'), n: 30, speed: [100, 500], life: [0.6, 1.4], tint: [0xffd27a, 0xffffff], blend: 'add' });
    await Promise.all([tweens.to(t, { alpha: 1 }, 400), tweens.to(t.scale, { x: 1, y: 1 }, 500, { ease: ease.outBack })]);
    await wait(tweens.skip ? 500 : 1800);
    session.finishCombat();
    await go(true);
  }

  // ═════════════ frame update ═════════════

  override update(dt: number) {
    this.hand.tick(dt);
    this.arrow.update(dt);
    this.fxLayer.update(dt);
    this.endBtn.tick(dt);
    for (const v of this.units.values()) v.tick(dt);
    this.ambAcc += dt;
    while (this.ambAcc > 120) { this.ambAcc -= 120; this.ambientSpawn?.(); }
    if (this.windowUi && this.windowTotal > 0 && !G.modalLayer.children.length) {
      this.windowTimer -= dt;
      const ring = (this.windowUi as Container & { ring?: Container & { sector?: Parameters<typeof sectorMask>[0] } }).ring;
      if (ring?.sector) {
        const k = Math.max(0, this.windowTimer / this.windowTotal);
        sectorMask(ring.sector, 64, k);
        ring.position.set(END_BTN.x + END_BTN.w + 40, END_BTN.y + END_BTN.h / 2);
      }
      if (this.windowTimer <= 0 && !this.busy && !this.targeting && !this.dragging) void this.passWindow();
    }
  }
}

function currentStatusesPartial(_v: UnitView, u: Unit, st: string, total: number) {
  const out = { ...u.statuses } as Record<string, number>;
  if (total > 0) out[st] = total; else delete out[st];
  return out;
}

function keywordName(k: string) {
  const map: Record<string, string> = { taunt: '坚守', ranged: '远射', leap: '奇袭', haste: '疾行', twinStrike: '连斩', ward: '灵障', lifesteal: '汲命', deathtouch: '断魂', thorns: '棘刺', stealth: '隐匿', growth: '滋长' };
  return map[k] ?? k;
}

function reasonText(err: string): string {
  if (err.includes('cost')) return '源不足';
  if (err.includes('target')) return '目标不合法';
  if (err.includes('slot')) return '无法放置';
  if (err.includes('already sacrificed')) return '本回合已献过牌';
  if (err.includes('cannot attack')) return '无法攻击';
  if (err.includes('busy')) return '请稍候';
  return err;
}

export { autoAnswer, responseOptions, isResponse, X, CMD_Y, FATE, alive };
