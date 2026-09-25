/** Particles, screen shake, hit-stop, floating numbers, dissolve. */
import { Container, Filter, GlProgram, Sprite, Text, Texture, type ContainerChild } from 'pixi.js';
import { assets, K } from '../assets';
import { tweens, ease } from '../core/tween';
import { FONT_NUM } from '../ui/theme';

/** particles use only generated effect textures (assets/effects/*); empty until loaded */
function softDot(_color?: string): Texture {
  return assets.get(K.fx('glow')) ?? Texture.EMPTY;
}

export function fxTexture(id: 'ember' | 'spark' | 'smoke' | 'ink_splash' | 'petal' | 'leaf' | 'frost' | 'glow' | 'ring' | 'flame' | 'slash' | 'rune'): Texture {
  return assets.get(K.fx(id)) ?? softDot();
}

export async function preloadFx() {
  await assets.loadMany(['ember', 'spark', 'smoke', 'ink_splash', 'petal', 'leaf', 'frost', 'glow', 'ring', 'flame', 'slash', 'rune'].map((x) => K.fx(x)));
}

interface P { s: Sprite; vx: number; vy: number; life: number; max: number; spin: number; grav: number; fade: boolean; scale0: number; scale1: number }

/** lightweight particle layer; call update(dt) each frame */
export class Particles extends Container {
  private ps: P[] = [];
  maxCount = 400;

  burst(x: number, y: number, o: { tex: Texture; n: number; speed: [number, number]; life: [number, number]; tint?: number | number[]; scale?: [number, number]; grav?: number; spread?: number; angle?: number; spin?: number; blend?: 'add' | 'normal'; scaleEnd?: number }) {
    for (let i = 0; i < o.n && this.ps.length < this.maxCount; i++) {
      const s = new Sprite(o.tex);
      s.anchor.set(0.5);
      s.position.set(x, y);
      const tint = Array.isArray(o.tint) ? o.tint[Math.floor(Math.random() * o.tint.length)]! : o.tint;
      if (tint !== undefined) s.tint = tint;
      if (o.blend === 'add') s.blendMode = 'add';
      const sc = (o.scale?.[0] ?? 0.2) + Math.random() * ((o.scale?.[1] ?? 0.4) - (o.scale?.[0] ?? 0.2));
      s.scale.set(sc * (64 / Math.max(o.tex.width, 1)));
      const a = (o.angle ?? -Math.PI / 2) + (Math.random() - 0.5) * (o.spread ?? Math.PI * 2);
      const sp = o.speed[0] + Math.random() * (o.speed[1] - o.speed[0]);
      const life = o.life[0] + Math.random() * (o.life[1] - o.life[0]);
      s.rotation = Math.random() * Math.PI * 2;
      this.addChild(s);
      this.ps.push({ s, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, spin: (Math.random() - 0.5) * (o.spin ?? 2), grav: o.grav ?? 0, fade: true, scale0: s.scale.x, scale1: s.scale.x * (o.scaleEnd ?? 0.3) });
    }
  }

  update(dtMs: number) {
    const dt = dtMs / 1000 * tweens.speed;
    for (let i = this.ps.length - 1; i >= 0; i--) {
      const p = this.ps[i]!;
      p.life -= dt;
      if (p.life <= 0) { p.s.destroy(); this.ps.splice(i, 1); continue; }
      p.vy += p.grav * dt;
      p.s.x += p.vx * dt;
      p.s.y += p.vy * dt;
      p.s.rotation += p.spin * dt;
      const k = p.life / p.max;
      p.s.alpha = Math.min(1, k * 2);
      const sc = p.scale1 + (p.scale0 - p.scale1) * k;
      p.s.scale.set(sc);
    }
  }

  /** ambient drifting motes (embers, petals, fireflies, dust) */
  ambient(kind: 'embers' | 'petals' | 'fireflies' | 'dust' | 'stars' | 'ink', w = 1920, h = 1080, rate = 1) {
    const tex = kind === 'embers' ? fxTexture('ember') : kind === 'petals' ? fxTexture('petal') : kind === 'ink' ? fxTexture('smoke') : softDot(kind === 'fireflies' ? '#c8ffa0' : kind === 'stars' ? '#fff4c8' : '#e8d8c0');
    const spawn = () => {
      if (Math.random() > rate) return;
      const x = Math.random() * w;
      const y = kind === 'embers' ? h + 20 : kind === 'petals' ? -20 : Math.random() * h;
      const up = kind === 'embers' ? -1 : 1;
      this.burst(x, y, {
        tex, n: 1, speed: kind === 'embers' ? [40, 90] : [10, 40], life: [4, 9], angle: up < 0 ? -Math.PI / 2 : Math.PI / 2 + 0.3, spread: 0.8,
        scale: kind === 'petals' ? [0.08, 0.16] : kind === 'embers' ? [0.1, 0.25] : [0.08, 0.2], blend: kind === 'petals' || kind === 'ink' ? 'normal' : 'add', scaleEnd: 0.6, spin: kind === 'petals' ? 3 : 0.5,
        tint: kind === 'ink' ? 0x222222 : undefined,
      });
    };
    return spawn;
  }
}

// ───────────── screen shake / hit stop ─────────────

export async function shake(target: Container, strength = 10, dur = 260, scale = 1) {
  const s = strength * scale;
  if (s <= 0) return;
  const ox = target.x, oy = target.y;
  await tweens.run(dur, (k) => {
    const d = s * (1 - k);
    target.x = ox + (Math.random() - 0.5) * 2 * d;
    target.y = oy + (Math.random() - 0.5) * 2 * d;
  }, { ease: ease.linear, unscaled: true });
  target.position.set(ox, oy);
}

/** freeze tween time briefly for impact (hit stop) */
export async function hitStop(ms = 70) {
  const prev = tweens.speed;
  tweens.speed = 0.02;
  await new Promise((r) => setTimeout(r, ms));
  tweens.speed = prev;
}

// ───────────── floating numbers ─────────────

export function floatText(layer: Container, text: string, x: number, y: number, o: { color?: number; size?: number; big?: boolean } = {}) {
  const t = new Text({ text, style: { fontFamily: FONT_NUM, fontSize: o.size ?? 44, fontWeight: '900', fill: o.color ?? 0xffffff, stroke: { color: 0x1b1512, width: 8 }, dropShadow: { color: 0x1b1512, blur: 0, distance: 4, alpha: 1, angle: Math.PI / 4 } } });
  t.anchor.set(0.5);
  t.position.set(x + (Math.random() - 0.5) * 30, y);
  t.scale.set(0.4);
  layer.addChild(t);
  void (async () => {
    await tweens.to(t.scale, { x: o.big ? 1.35 : 1.1, y: o.big ? 1.35 : 1.1 }, 140, { ease: ease.outBack });
    await Promise.all([tweens.to(t, { y: y - 90, alpha: 0 }, 850, { ease: ease.inQuad }), tweens.to(t.scale, { x: 0.9, y: 0.9 }, 850)]);
    t.destroy();
  })();
}

// ───────────── dissolve shader ─────────────

const DISSOLVE_FRAG = `
in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform float uProgress;
uniform vec3 uEdge;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x), mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.,1.)),f.x), f.y); }
void main(){
  vec4 c = texture(uTexture, vTextureCoord);
  float n = noise(vTextureCoord * 18.0) * 0.6 + noise(vTextureCoord * 48.0) * 0.4;
  float t = uProgress * 1.15;
  if (n < t - 0.08) { finalColor = vec4(0.0); return; }
  float edge = smoothstep(t - 0.08, t + 0.02, n);
  vec3 col = mix(uEdge * 1.6, c.rgb, edge);
  finalColor = vec4(col * c.a, c.a);
}`;

const DISSOLVE_VERT = `
in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
vec4 filterVertexPosition(void){
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}
vec2 filterTextureCoord(void){ return aPosition * (uOutputFrame.zw * uInputSize.zw); }
void main(void){ gl_Position = filterVertexPosition(); vTextureCoord = filterTextureCoord(); }`;

export function dissolveFilter(edge = [1.0, 0.55, 0.2]): Filter & { progress: number } {
  const f = new Filter({
    glProgram: GlProgram.from({ vertex: DISSOLVE_VERT, fragment: DISSOLVE_FRAG, name: 'dissolve' }),
    resources: { dissolveUniforms: { uProgress: { value: 0, type: 'f32' }, uEdge: { value: new Float32Array(edge), type: 'vec3<f32>' } } },
  }) as Filter & { progress: number };
  Object.defineProperty(f, 'progress', {
    get: () => (f.resources.dissolveUniforms as { uniforms: { uProgress: number } }).uniforms.uProgress,
    set: (v: number) => { (f.resources.dissolveUniforms as { uniforms: { uProgress: number } }).uniforms.uProgress = v; },
  });
  return f;
}

export async function dissolve(obj: ContainerChild, dur = 520, edge?: number[]) {
  try {
    const f = dissolveFilter(edge);
    obj.filters = [f];
    await tweens.run(dur, (k) => { f.progress = k; }, { ease: ease.inQuad });
  } catch {
    await tweens.to(obj, { alpha: 0 }, dur);
  }
}
