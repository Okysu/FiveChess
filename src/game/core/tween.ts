/** Minimal promise-based tween engine driven by the app ticker, with a global speed multiplier. */
export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => t * (2 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inBack: (t: number) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; },
  outElastic: (t: number) => (t === 0 || t === 1 ? t : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  outExpo: (t: number) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
};

interface Tw {
  target: Record<string, number>;
  from: Record<string, number>;
  to: Record<string, number>;
  dur: number;
  t: number;
  delay: number;
  ease: Ease;
  resolve: () => void;
  onUpdate?: (k: number) => void;
  key?: unknown;
  scaled: boolean;
}

class TweenManager {
  private list: Tw[] = [];
  /** global animation speed (1 = normal, 2 = fast) */
  speed = 1;
  /** skip non-critical animations entirely */
  skip = false;

  update(dtMs: number) {
    if (!this.list.length) return;
    const done: Tw[] = [];
    for (const tw of [...this.list]) {
      const dt = tw.scaled ? dtMs * this.speed : dtMs;
      if (tw.delay > 0) { tw.delay -= dt; if (tw.delay > 0) continue; }
      if (tw.t === 0) for (const k of Object.keys(tw.to)) tw.from[k] = tw.target[k] ?? 0;
      tw.t += dt;
      const k = Math.min(1, tw.dur <= 0 ? 1 : tw.t / tw.dur);
      const e = tw.ease(k);
      for (const key of Object.keys(tw.to)) tw.target[key] = tw.from[key]! + (tw.to[key]! - tw.from[key]!) * e;
      tw.onUpdate?.(e);
      if (k >= 1) done.push(tw);
    }
    for (const d of done) { this.list.splice(this.list.indexOf(d), 1); d.resolve(); }
  }

  to(target: object, to: Record<string, number>, dur: number, opts: { ease?: Ease; delay?: number; onUpdate?: (k: number) => void; key?: unknown; unscaled?: boolean } = {}): Promise<void> {
    if (opts.key !== undefined) this.kill(opts.key);
    return new Promise((resolve) => {
      this.list.push({
        target: target as unknown as Record<string, number>, from: {}, to: to as Record<string, number>, dur, t: 0, delay: opts.delay ?? 0,
        ease: opts.ease ?? ease.outCubic, resolve, onUpdate: opts.onUpdate, key: opts.key, scaled: !opts.unscaled,
      });
    });
  }

  /** animate an arbitrary 0→1 progress value */
  run(dur: number, fn: (k: number) => void, opts: { ease?: Ease; delay?: number; key?: unknown; unscaled?: boolean } = {}): Promise<void> {
    const o = { v: 0 };
    return this.to(o, { v: 1 }, dur, { ...opts, onUpdate: () => fn(o.v) });
  }

  kill(key: unknown) {
    for (const tw of [...this.list]) if (tw.key === key) { this.list.splice(this.list.indexOf(tw), 1); tw.resolve(); }
  }

  killTarget(target: object) {
    for (const tw of [...this.list]) if (tw.target === (target as unknown)) { this.list.splice(this.list.indexOf(tw), 1); tw.resolve(); }
  }

  wait(ms: number): Promise<void> {
    return this.run(ms, () => undefined, { ease: ease.linear });
  }

  get busy() { return this.list.length > 0; }
}

export const tweens = new TweenManager();
export const wait = (ms: number) => tweens.wait(ms);
