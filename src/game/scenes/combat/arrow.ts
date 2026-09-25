/** Quadratic-bezier targeting arrow made of flowing swallow-tail segments (UI研究笔记 §3.3). */
import { Container, Graphics } from 'pixi.js';

export class Arrow extends Container {
  private g = new Graphics();
  private head = new Graphics();
  private t = 0;
  from = { x: 0, y: 0 };
  to = { x: 0, y: 0 };
  state: 'neutral' | 'valid' | 'invalid' = 'neutral';

  constructor() {
    super();
    this.addChild(this.g, this.head);
    this.eventMode = 'none';
    this.visible = false;
  }

  show(fx: number, fy: number) { this.from = { x: fx, y: fy }; this.visible = true; }
  hide() { this.visible = false; }

  update(dt: number) {
    if (!this.visible) return;
    this.t += dt;
    const P0 = this.from, P2 = this.to;
    const d = Math.hypot(P2.x - P0.x, P2.y - P0.y);
    const P1 = { x: (P0.x + P2.x) / 2, y: (P0.y + P2.y) / 2 - Math.min(260, 0.35 * d) };
    const col = this.state === 'valid' ? 0xffb03a : this.state === 'invalid' ? 0x8a8a8a : 0xf3e6c8;
    const g = this.g;
    g.clear();
    const N = 14;
    const flow = (this.t / 600) % 1;
    for (let i = 0; i < N; i++) {
      const tt = Math.min(0.94, (i + flow) / N);
      const p = bez(P0, P1, P2, tt);
      const q = bez(P0, P1, P2, Math.min(1, tt + 0.02));
      const ang = Math.atan2(q.y - p.y, q.x - p.x);
      const s = 7 + 7 * tt;
      const a = 0.35 + 0.65 * tt;
      // swallow-tail chevron
      const cos = Math.cos(ang), sin = Math.sin(ang);
      const pts = [[s, 0], [-s * 0.6, s * 0.75], [-s * 0.2, 0], [-s * 0.6, -s * 0.75]].map(([x, y]) => [p.x + x! * cos - y! * sin, p.y + x! * sin + y! * cos]);
      g.poly(pts.flat()).fill({ color: col, alpha: a });
    }
    const end = bez(P0, P1, P2, 1), pre = bez(P0, P1, P2, 0.96);
    const ang = Math.atan2(end.y - pre.y, end.x - pre.x);
    const h = this.head;
    h.clear();
    h.position.set(end.x, end.y);
    h.rotation = ang;
    if (this.state === 'invalid') {
      h.moveTo(-14, -14).lineTo(14, 14).moveTo(14, -14).lineTo(-14, 14).stroke({ width: 6, color: 0xc84a3a });
    } else {
      h.poly([18, 0, -18, 18, -8, 0, -18, -18]).fill({ color: col }).stroke({ width: 2, color: 0x2a1406 });
      if (this.state === 'valid') h.circle(0, 0, 30).stroke({ width: 3, color: 0xffd46a, alpha: 0.8 });
    }
  }
}

function bez(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, t: number) {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * b.x + t * t * c.x, y: u * u * a.y + 2 * u * t * b.y + t * t * c.y };
}

export { Graphics };
