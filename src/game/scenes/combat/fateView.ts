/** Shared fate deck, discard, signs and the signature centered judgement flip (UI研究笔记 §7.3). */
import { Container, Sprite, Text } from 'pixi.js';
import type { CombatState, FateCard } from '../../../engine/combat/state';
import { SUIT_INFO } from '../../../engine/glossary';
import { WB, uiFill, suitIcon } from '../../ui/skin';
import { C, FONT_NUM, FONT_TITLE } from '../../ui/theme';
import { tweens, ease, wait } from '../../core/tween';
import { FATE } from './layout';
import { sfx } from '../../audio/audio';
import type { Particles } from '../../fx/fx';
import { fxTexture } from '../../fx/fx';
import { Tooltip, hideTip, showTip } from '../../ui/widgets';
import { session } from '../../state';

const W = 120, H = 168;
const RANK = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一', '十二', '十三'];

/** a fate card: generated woodblock face / back textures + generated suit emblem + rank text */
export class FateCardView extends Container {
  private face = new Container();
  private back: Container;
  constructor(public card: FateCard | null) {
    super();
    this.back = uiFill('fate_back', W, H);
    this.back.position.set(-W / 2, -H / 2);
    this.addChild(this.back, this.face);
    if (card) this.setCard(card);
    this.setFace(!!card);
  }
  setCard(c: FateCard) {
    this.card = c;
    this.face.removeChildren().forEach((x) => x.destroy({ children: true }));
    const bg = uiFill('fate_face', W, H, c.omen ? { tint: 0x5a2a22 } : {});
    bg.position.set(-W / 2, -H / 2);
    this.face.addChild(bg);
    const info = SUIT_INFO[c.suit];
    if (c.omen) {
      const t = new Text({ text: '凶', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 64, fill: WB.vermilion, stroke: { color: WB.ink, width: 6 } } });
      t.anchor.set(0.5);
      this.face.addChild(t);
      return;
    }
    const em = suitIcon(c.suit, 70);
    em.y = 6;
    this.face.addChild(em);
    const rankStyle = { fontFamily: FONT_NUM, fontWeight: '900' as const, fontSize: 26, fill: info.color, stroke: { color: WB.ink, width: 4 } };
    const r1 = new Text({ text: RANK[c.rank] ?? String(c.rank), style: rankStyle });
    r1.position.set(-W / 2 + 12, -H / 2 + 8);
    const r2 = new Text({ text: RANK[c.rank] ?? '', style: rankStyle });
    r2.anchor.set(1, 1); r2.rotation = Math.PI;
    r2.position.set(-W / 2 + 12, -H / 2 + 8);
    r2.position.set(W / 2 - 12, H / 2 - 8);
    r2.anchor.set(0, 0);
    const cn = new Text({ text: CN[c.rank] ?? '', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 14, fill: WB.ink } });
    cn.position.set(-W / 2 + 13, -H / 2 + 38);
    this.face.addChild(r1, r2, cn);
    if (session.settings.suitText) {
      const nm = new Text({ text: info.name[0] ?? '', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 16, fill: WB.ink } });
      nm.anchor.set(1, 0);
      nm.position.set(W / 2 - 12, -H / 2 + 10);
      this.face.addChild(nm);
    }
  }
  setFace(up: boolean) { this.face.visible = up; this.back.visible = !up; }
  async flip() {
    await tweens.to(this.scale, { x: 0 }, 150, { ease: ease.inQuad });
    this.setFace(true);
    await tweens.to(this.scale, { x: this.scale.y }, 180, { ease: ease.outQuad });
  }
}

export class FateArea extends Container {
  private deck = new Container();
  private deckCount: Text;
  private discard = new Container();
  private signs = new Container();
  private known = new Container();

  constructor() {
    super();
    this.deckCount = new Text({ text: '', style: { fontFamily: FONT_NUM, fontSize: 20, fill: C.goldLight, stroke: { color: 0, width: 4 } } });
    this.deckCount.anchor.set(0.5, 0);
    this.deckCount.position.set(FATE.deck.x, FATE.deck.y + 88);
    const lbl = new Text({ text: '天命', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 20, fill: C.goldLight, stroke: { color: 0, width: 4 } } });
    lbl.anchor.set(0.5, 1);
    lbl.position.set(FATE.deck.x, FATE.deck.y - 88);
    this.addChild(this.known, this.deck, this.discard, this.signs, this.deckCount, lbl);
    this.deck.eventMode = 'static';
    this.deck.cursor = 'help';
    this.deck.on('pointerover', () => showTip(new Tooltip([{ title: '天命牌堆', body: '双方共享。[判定]时翻开牌堆顶。日纹、雷纹为阳；月纹、山纹为阴。可被[窥视]、[观星]与[改判]操控。' }]), FATE.deck.x + 70, FATE.deck.y - 60));
    this.deck.on('pointerout', hideTip);
  }

  sync(s: CombatState) {
    this.deck.removeChildren();
    const n = s.fate.deck.length;
    for (let i = 0; i < Math.min(6, Math.ceil(n / 8)); i++) {
      const v = new FateCardView(null);
      v.position.set(FATE.deck.x + i * 1.2, FATE.deck.y - i * 1.5);
      this.deck.addChild(v);
    }
    this.deckCount.text = `${n}`;
    // known top cards (peeked)
    this.known.removeChildren();
    const known = s.fate.deck.slice(-s.fate.known).reverse();
    known.slice(0, 5).forEach((c, i) => {
      const v = new FateCardView(c);
      v.scale.set(0.4);
      v.position.set(FATE.deck.x - 95 - i * 0, FATE.deck.y - 60 + i * 30);
      this.known.addChild(v);
    });
    if (known.length) {
      const top = new FateCardView(known[0]!);
      top.alpha = 0.45;
      top.position.set(FATE.deck.x + 8, FATE.deck.y - 9);
      this.deck.addChild(top);
    }
    // discard
    this.discard.removeChildren();
    const last = s.fate.discard[s.fate.discard.length - 1];
    if (last) {
      const v = new FateCardView(last);
      v.scale.set(0.75);
      v.position.set(FATE.discard.x, FATE.discard.y);
      this.discard.addChild(v);
    }
    // signs
    this.signs.removeChildren();
    s.fate.signs.forEach((c, i) => {
      const v = new FateCardView(c);
      v.scale.set(0.5);
      v.position.set(FATE.signs.x - 30 + i * 62, FATE.signs.y + 20);
      v.eventMode = 'static';
      v.on('pointerover', () => showTip(new Tooltip([{ title: '命签', body: `${SUIT_INFO[c.suit].name} ${c.rank}。判定翻开后，可打出命签替换判定牌（[改判]）。` }]), FATE.signs.x + 40, FATE.signs.y + 60));
      v.on('pointerout', hideTip);
      this.signs.addChild(v);
    });
  }

  /** the signature judgement flip; returns once the card rests in the center */
  async judgeFlip(layer: Container, card: FateCard, reason: string, parts: Particles, fast: boolean): Promise<FateCardView> {
    const v = new FateCardView(null);
    v.card = card;
    v.position.set(FATE.deck.x, FATE.deck.y);
    layer.addChild(v);
    sfx('judgeFlip');
    await tweens.to(v, { y: FATE.deck.y - 20 }, fast ? 80 : 200);
    await Promise.all([tweens.to(v, { x: FATE.judge.x, y: FATE.judge.y }, fast ? 160 : 300, { ease: ease.outCubic }), tweens.to(v.scale, { x: 2.2, y: 2.2 }, fast ? 160 : 300)]);
    let label: Text | null = null;
    if (!fast && reason) {
      label = new Text({ text: reason, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 30, fill: C.goldLight, stroke: { color: 0, width: 5 }, align: 'center' } });
      label.anchor.set(0.5);
      label.position.set(FATE.judge.x, FATE.judge.y - 235);
      layer.addChild(label);
      await wait(150);
    }
    v.setCard(card);
    await v.flip();
    this.suitBurst(layer, card, parts);
    if (label) void tweens.to(label, { alpha: 0 }, 300).then(() => label!.destroy());
    return v;
  }

  suitBurst(layer: Container, card: FateCard, parts: Particles) {
    const info = SUIT_INFO[card.suit];
    sfx(card.suit === 'sun' ? 'judgeSun' : card.suit === 'thunder' ? 'judgeThunder' : card.suit === 'moon' ? 'judgeMoon' : 'judgeMountain');
    parts.burst(FATE.judge.x, FATE.judge.y, { tex: fxTexture('spark'), n: 36, speed: [180, 520], life: [0.4, 1.0], tint: [info.color, 0xffffff], scale: [0.2, 0.5], blend: 'add' });
    const ring = new Sprite(fxTexture('ring'));
    ring.anchor.set(0.5);
    ring.tint = info.color;
    ring.blendMode = 'add';
    ring.position.set(FATE.judge.x, FATE.judge.y);
    ring.scale.set(0.3);
    layer.addChild(ring);
    void tweens.to(ring.scale, { x: 3, y: 3 }, 600, { ease: ease.outCubic });
    void tweens.to(ring, { alpha: 0 }, 600).then(() => ring.destroy());
  }

  async resultAndDiscard(v: FateCardView, branch: string, fast: boolean) {
    const suitName = v.card ? SUIT_INFO[v.card.suit].name : '';
    const yang = v.card ? SUIT_INFO[v.card.suit].yang : false;
    const t = new Text({ text: branch === 'omen' ? '凶兆' : `${yang ? '阳' : '阴'} · ${suitName}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 42, fill: yang ? 0xffd27a : 0xa8d8ff, stroke: { color: 0, width: 6 } } });
    t.anchor.set(0.5);
    t.position.set(FATE.judge.x, FATE.judge.y + 215);
    v.parent?.addChild(t);
    t.scale.set(1.6);
    void tweens.to(t.scale, { x: 1, y: 1 }, 220, { ease: ease.outBack });
    await wait(fast ? 250 : 650);
    await Promise.all([tweens.to(v, { x: FATE.discard.x, y: FATE.discard.y }, fast ? 160 : 300, { ease: ease.inOutCubic }), tweens.to(v.scale, { x: 0.75, y: 0.75 }, fast ? 160 : 300), tweens.to(t, { alpha: 0 }, 250)]);
    t.destroy();
    v.destroy();
  }

  async rejudge(layer: Container, v: FateCardView, now: FateCard, parts: Particles) {
    sfx('rejudge');
    const sign = new FateCardView(now);
    sign.scale.set(0.5);
    sign.position.set(FATE.signs.x, FATE.signs.y + 20);
    layer.addChild(sign);
    await Promise.all([tweens.to(sign, { x: FATE.judge.x, y: FATE.judge.y }, 360, { ease: ease.outCubic }), tweens.to(sign.scale, { x: 2.2, y: 2.2 }, 360)]);
    await Promise.all([tweens.to(v, { x: FATE.discard.x, y: FATE.discard.y, alpha: 0.6 }, 300), tweens.to(v.scale, { x: 0.75, y: 0.75 }, 300)]);
    v.destroy();
    this.suitBurst(layer, now, parts);
    return sign;
  }
}
