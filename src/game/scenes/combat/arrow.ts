/** Quadratic-bezier targeting arrow built from generated woodblock chevron + arrowhead sprites (UI研究笔记 §3.3). */
import { Container, Sprite, Texture } from 'pixi.js';
import { assets, K } from '../../assets';

const N = 14;

export class Arrow extends Container {
  private segs: Sprite[] = [];
  private head = new Sprite();
  private mark = new Sprite();
  private t = 0;
  from = { x: 0, y: 0 };
  to = { x: 0, y: 0 };
  state: 'neutral' | 'valid' | 'invalid' = 'neutral';

  constructor() {
    super();
    for (let i = 0; i < N; i++) { const s = new Sprite(); s.anchor.set(0.5); this.segs.push(s); this.addChild(s); }
    this.head.anchor.set(0.3, 0.5);
    this.mark.anchor.set(0.5);
    this.addChild(this.head, this.mark);
    this.eventMode = 'none';
    this.visible = false;
    const apply = () => {
      const c = assets.get(K.ui('arrow_chevron')) ?? Texture.EMPTY;
      for (const s of this.segs) s.texture = c;
      this.head.texture = assets.get(K.ui('arrow_head')) ?? Texture.EMPTY;
      this.mark.texture = assets.get(K.ui('ring_gold')) ?? Texture.EMPTY;
    };
    apply();
    for (const id of ['arrow_chevron', 'arrow_head', 'ring_gold']) assets.with(K.ui(id), apply);
  }

  show(fx: number, fy: number) { this.from = { x: fx, y: fy }; this.visible = true; }
  hide() { this.visible = false; }

  update(dt: number) {
    if (!this.visible) return;
    this.t += dt;
    const P0 = this.from, P2 = this.to;
    const d = Math.hypot(P2.x - P0.x, P2.y - P0.y);
    const P1 = { x: (P0.x + P2.x) / 2, y: (P0.y + P2.y) / 2 - Math.min(260, 0.35 * d) };
    // state is communicated by tinting the generated woodblock pieces
    const tint = this.state === 'valid' ? 0xffffff : this.state === 'invalid' ? 0x6a6560 : 0xd8c8b0;
    const flow = (this.t / 600) % 1;
    this.segs.forEach((s, i) => {
      const tt = Math.min(0.94, (i + flow) / N);
      const p = bez(P0, P1, P2, tt);
      const q = bez(P0, P1, P2, Math.min(1, tt + 0.02));
      s.position.set(p.x, p.y);
      s.rotation = Math.atan2(q.y - p.y, q.x - p.x);
      const size = 18 + 16 * tt;
      if (s.texture.width) s.scale.set(size / s.texture.width);
      s.alpha = 0.45 + 0.55 * tt;
      s.tint = tint;
    });
    const end = bez(P0, P1, P2, 1), pre = bez(P0, P1, P2, 0.96);
    this.head.position.set(end.x, end.y);
    this.head.rotation = Math.atan2(end.y - pre.y, end.x - pre.x);
    if (this.head.texture.width) this.head.scale.set(52 / this.head.texture.width);
    this.head.tint = tint;
    this.mark.visible = this.state === 'valid';
    this.mark.position.set(end.x, end.y);
    if (this.mark.texture.width) this.mark.scale.set(72 / this.mark.texture.width);
  }
}

function bez(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y };
}
