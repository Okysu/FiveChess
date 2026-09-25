/** Fanned hand with static hit zones and neighbor make-room (UI研究笔记 §2.3). */
import { Container, type FederatedPointerEvent } from 'pixi.js';
import { hitRect } from '../../ui/skin';
import type { CardInst } from '../../../engine/combat/state';
import { CardView, type CardLive } from '../../ui/card';
import { tweens, ease } from '../../core/tween';
import { HAND } from './layout';
import { sfx } from '../../audio/audio';

interface Slot { x: number; y: number; rot: number }

export class HandView extends Container {
  views: CardView[] = [];
  hovered: CardView | null = null;
  lifted = new Set<number>(); // uids lifted (e.g. response cards during a window)
  dimmed = false;
  sunk = 0;
  hoverScale = HAND.hoverScale;
  private hit = hitRect(HAND.x0 - 40, 800, HAND.x1 - HAND.x0 + 80, 280);
  private graceTimer = 0;
  private pendingHover: CardView | null = null;
  onHover?: (v: CardView | null) => void;
  onPress?: (v: CardView, e: FederatedPointerEvent) => void;
  onRightClick?: (v: CardView) => void;
  onEmptyPress?: () => void;
  /** set by scene while a card is dragged/selected */
  frozen: CardView | null = null;

  constructor() {
    super();
    this.addChild(this.hit);
    this.hit.on('pointermove', (e) => this.pointerAt(e.global));
    this.hit.on('pointerout', () => this.setHover(null));
    this.hit.on('pointerdown', (e: FederatedPointerEvent) => {
      const v = this.cardAt(e.global);
      if (!v) { this.onEmptyPress?.(); return; }
      if (e.button === 2) { this.onRightClick?.(v); return; }
      this.onPress?.(v, e);
    });
    this.sortableChildren = true;
  }

  private toLocal2(p: { x: number; y: number }) { return this.toLocal(p); }

  slots(n: number): Slot[] {
    const out: Slot[] = [];
    if (n === 0) return out;
    const width = HAND.x1 - HAND.x0;
    const cw = 200;
    const pitch = n === 1 ? 0 : Math.min(150, (width - cw) / (n - 1));
    const step = n === 1 ? 0 : Math.min(4, 28 / (n - 1));
    const cx = (HAND.x0 + HAND.x1) / 2;
    const R = 2400;
    for (let i = 0; i < n; i++) {
      const off = i - (n - 1) / 2;
      const x = cx + off * pitch;
      const deg = off * step;
      const rad = (deg * Math.PI) / 180;
      const y = HAND.y + (R - Math.cos(rad) * R) + this.sunk;
      out.push({ x, y, rot: rad });
    }
    return out;
  }

  private cardAt(g: { x: number; y: number }): CardView | null {
    const p = this.toLocal2(g);
    const n = this.views.length;
    if (!n || p.y < 800) return null;
    const sl = this.slots(n);
    const pitch = n > 1 ? sl[1]!.x - sl[0]!.x : 200;
    // hovered card gets priority over its (visual) full width
    if (this.hovered) {
      const hi = this.views.indexOf(this.hovered);
      const s = sl[hi];
      if (s && Math.abs(p.x - s.x) < 110 && p.y > 640) return this.hovered;
    }
    let best: CardView | null = null;
    let bd = Infinity;
    sl.forEach((s, i) => {
      const d = Math.abs(p.x - s.x);
      if (d < Math.max(pitch / 2, 30) + 2 && d < bd) { bd = d; best = this.views[i]!; }
    });
    if (!best && p.x >= sl[0]!.x - 100 && p.x <= sl[n - 1]!.x + 100) best = p.x < sl[0]!.x ? this.views[0]! : this.views[n - 1]!;
    return best;
  }

  private pointerAt(g: { x: number; y: number }) {
    if (this.frozen) return;
    const v = this.cardAt(g);
    if (v === this.hovered) { this.pendingHover = null; return; }
    // 60ms grace to avoid flicker
    this.pendingHover = v;
    this.graceTimer = 60;
  }

  tick(dt: number) {
    if (this.pendingHover !== null || (this.graceTimer > 0 && this.pendingHover === null)) {
      this.graceTimer -= dt;
      if (this.graceTimer <= 0) { this.setHover(this.pendingHover); this.pendingHover = null; }
    }
  }

  setHover(v: CardView | null) {
    if (this.frozen) return;
    if (v === this.hovered) return;
    this.hovered = v;
    if (v) sfx('cardHover');
    this.onHover?.(v);
    this.layout(true);
  }

  add(card: CardInst, live: CardLive, from?: { x: number; y: number }, faceDownFirst = false): CardView {
    const v = new CardView(card, { live });
    v.cardUid = card.uid;
    if (from) { const p = this.toLocal(from); v.position.set(p.x, p.y); v.scale.set(0.3); v.rotation = -0.4; }
    if (faceDownFirst) v.setFaceDown(true);
    this.views.push(v);
    this.addChild(v);
    return v;
  }

  take(uid: number): CardView | null {
    const i = this.views.findIndex((v) => v.cardUid === uid);
    if (i < 0) return null;
    const v = this.views[i]!;
    this.views.splice(i, 1);
    if (this.hovered === v) this.hovered = null;
    if (this.frozen === v) this.frozen = null;
    return v;
  }

  /** reorder views to match the hand list, create/destroy as needed */
  reconcile(hand: CardInst[], live: (c: CardInst) => CardLive) {
    const keep: CardView[] = [];
    for (const c of hand) {
      let v = this.views.find((x) => x.cardUid === c.uid);
      if (!v) v = this.add(c, live(c), { x: 70, y: 990 });
      keep.push(v);
    }
    for (const v of this.views) if (!keep.includes(v)) { v.destroy({ children: true }); }
    this.views = keep;
    for (const v of keep) { const c = hand.find((h) => h.uid === v.cardUid)!; v.update(live(c)); }
  }

  layout(animate = true, dur = 160) {
    const n = this.views.length;
    const sl = this.slots(n);
    const hi = this.hovered ? this.views.indexOf(this.hovered) : -1;
    const hs = n >= 8 ? 1.6 : this.hoverScale;
    this.views.forEach((v, i) => {
      if (v === this.frozen) return;
      const s = sl[i]!;
      let x = s.x, y = s.y, rot = s.rot, sc = HAND.cardScale;
      if (hi >= 0 && i !== hi) {
        const d = i - hi;
        const push = Math.abs(d) === 1 ? 70 : Math.abs(d) === 2 ? 35 : Math.abs(d) === 3 ? 12 : 0;
        x += Math.sign(d) * push;
      }
      if (this.lifted.has(v.cardUid)) y -= 40;
      if (i === hi) { sc = HAND.cardScale * hs; rot = 0; y = 1080 - (420 * sc) / 2; }
      v.zIndex = i === hi ? 100 : i;
      v.alpha = this.dimmed && !this.lifted.has(v.cardUid) && i !== hi ? 0.72 : 1;
      if (animate) {
        void tweens.to(v, { x, y, rotation: rot }, dur, { ease: ease.outCubic, key: `hand:${v.cardUid}` });
        void tweens.to(v.scale, { x: sc, y: sc }, dur, { ease: ease.outCubic, key: `handS:${v.cardUid}` });
      } else { v.position.set(x, y); v.rotation = rot; v.scale.set(sc); }
    });
  }
}
