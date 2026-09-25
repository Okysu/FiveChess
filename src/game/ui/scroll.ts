/** Vertical (or horizontal) scroll container with mask, wheel, drag and a thin scrollbar. */
import { Container, Graphics, type FederatedPointerEvent, type FederatedWheelEvent } from 'pixi.js';
import { C } from './theme';

export class ScrollBox extends Container {
  readonly content = new Container();
  private maskG = new Graphics();
  private bar = new Graphics();
  private dragging = false;
  private dragStart = 0;
  private startPos = 0;
  private moved = 0;
  offset = 0;

  constructor(readonly vw: number, readonly vh: number, readonly horizontal = false) {
    super();
    this.maskG.rect(0, 0, vw, vh).fill(0xffffff);
    this.addChild(this.maskG, this.content, this.bar);
    this.content.mask = this.maskG;
    const hit = new Graphics().rect(0, 0, vw, vh).fill({ color: 0x000000, alpha: 0.001 });
    hit.eventMode = 'static';
    this.addChildAt(hit, 0);
    this.eventMode = 'passive';
    this.on('wheel', (e: FederatedWheelEvent) => { this.scrollBy(this.horizontal ? e.deltaY + e.deltaX : e.deltaY); });
    this.on('pointerdown', (e: FederatedPointerEvent) => { this.dragging = true; this.moved = 0; this.dragStart = this.horizontal ? e.global.x : e.global.y; this.startPos = this.offset; });
    hit.on('globalpointermove', (e: FederatedPointerEvent) => {
      if (!this.dragging) return;
      const cur = this.horizontal ? e.global.x : e.global.y;
      const d = (this.dragStart - cur) / (this.worldTransform.a || 1);
      this.moved = Math.max(this.moved, Math.abs(d));
      if (this.moved > 8) this.setOffset(this.startPos + d);
    });
    this.on('pointerup', () => { this.dragging = false; });
    hit.on('pointerupoutside', () => { this.dragging = false; });
  }

  /** true if the last pointer interaction was a drag (so child taps can ignore it) */
  get wasDrag() { return this.moved > 8; }

  get contentSize() {
    const b = this.content.getLocalBounds();
    return this.horizontal ? b.x + b.width : b.y + b.height;
  }

  scrollBy(d: number) { this.setOffset(this.offset + d); }

  setOffset(o: number) {
    const max = Math.max(0, this.contentSize - (this.horizontal ? this.vw : this.vh) + 20);
    this.offset = Math.max(0, Math.min(max, o));
    if (this.horizontal) this.content.x = -this.offset; else this.content.y = -this.offset;
    this.drawBar(max);
  }

  refresh() { this.setOffset(this.offset); }

  private drawBar(max: number) {
    this.bar.clear();
    if (max <= 0) return;
    const view = this.horizontal ? this.vw : this.vh;
    const len = Math.max(40, (view * view) / (view + max));
    const pos = (this.offset / max) * (view - len);
    if (this.horizontal) this.bar.roundRect(pos, this.vh - 6, len, 5, 3).fill({ color: C.gold, alpha: 0.6 });
    else this.bar.roundRect(this.vw - 6, pos, 5, len, 3).fill({ color: C.gold, alpha: 0.6 });
  }
}
