/** Pixi application shell: design-space scaling, layers, scene manager, keyboard routing. */
import { Application, Container, Sprite, Texture } from 'pixi.js';
import { pickProfile, setProfile, isPhone } from '../ui/profile';
import { uiFill } from '../ui/skin';
import { tweens, ease } from './tween';
import { DESIGN_H, DESIGN_W } from '../ui/theme';

export abstract class Scene extends Container {
  /** full-screen backdrop texture key (drawn behind the design area, cover-fit) */
  backdropKey: string | null = null;
  backdropTint = 0xffffff;
  /** build the scene; runs while the transition curtain is down */
  enter(): void | Promise<void> {}
  /** runs once the curtain has lifted (intros, tutorials, anything the player must see) */
  shown(): void | Promise<void> {}
  exit(): void {}
  update(_dt: number): void {}
  onKey(_e: KeyboardEvent): boolean { return false; }
  /** return true if the scene handled Esc / back */
  onBack(): boolean { return false; }
}

class GameApp {
  app!: Application;
  /** full-screen layer (backdrops) */
  backdrop = new Container();
  /** design-space root (1920×1080), letterboxed */
  root = new Container();
  sceneLayer = new Container();
  modalLayer = new Container();
  tipLayer = new Container();
  toastLayer = new Container();
  fade = new Container();
  scene: Scene | null = null;
  private sceneReady = false;
  scale = 1;
  compact = false;
  private backdropSprite = new Sprite(Texture.EMPTY);
  private keyHandlers: ((e: KeyboardEvent) => boolean)[] = [];

  async init(host: HTMLElement) {
    this.app = new Application();
    await this.app.init({
      resizeTo: window, background: '#0b0806', antialias: true,
      resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, preference: 'webgl',
    });
    host.appendChild(this.app.canvas);
    this.app.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    const stage = this.app.stage;
    // passive: 'static' on an ancestor makes Pixi hit-test every descendant, so decorative text/sprites would swallow clicks
    stage.eventMode = 'passive';
    stage.addChild(this.backdrop, this.root);
    this.backdrop.addChild(this.backdropSprite);
    this.root.addChild(this.sceneLayer, this.modalLayer, this.tipLayer, this.toastLayer, this.fade);
    this.root.sortableChildren = false;
    // transition curtain: the generated ink texture, fully inked
    this.fade.addChild(uiFill('dim_vignette', DESIGN_W, DESIGN_H, { tint: 0x000000 }));
    this.fade.alpha = 0;
    this.fade.eventMode = 'none';
    window.addEventListener('resize', () => this.layout());
    window.addEventListener('orientationchange', () => setTimeout(() => this.layout(), 150));
    this.layout();
    this.app.ticker.add((t) => {
      tweens.update(t.deltaMS);
      // a scene only ticks once enter() has built it (enter awaits asset loads)
      if (this.sceneReady) this.scene?.update(t.deltaMS);
    });
    window.addEventListener('keydown', (e) => { if (this.dispatchKey(e)) e.preventDefault(); });
  }

  /** portrait touch screens: the 16:9 game is drawn rotated 90° so it fills the phone (works with rotation lock) */
  rotated = false;
  /** visible screen in design space: the 1920×1080 design sits centred inside it; edge-anchored UI uses these bounds */
  view = { left: 0, top: 0, right: DESIGN_W, bottom: DESIGN_H, width: DESIGN_W, height: DESIGN_H };
  /**
   * HUD safe area in design space: edge-anchored UI (top bar, hand, buttons, piles, legends, tooltips) stays inside it.
   * = view shrunk by the device's safe-area insets (env(safe-area-inset-*): notches, rounded corners) and by the
   * player's 显示 → HUD 安全区 margin (a fraction of the screen on every side, like a console's calibration).
   */
  hud = { left: 0, top: 0, right: DESIGN_W, bottom: DESIGN_H, width: DESIGN_W, height: DESIGN_H };
  /** player margin, 0 – 0.1 of the screen size per side */
  hudMargin = 0;
  setHudMargin(m: number) { this.hudMargin = Math.max(0, Math.min(0.1, m)); this.layout(); }
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  /** the HUD safe area for a given margin (calibration previews it before applying) */
  hudRect(v = this.view, margin = this.hudMargin) {
    const mx = v.width * margin, my = v.height * margin, d = this.insets;
    const left = v.left + Math.max(d.left, mx), top = v.top + Math.max(d.top, my);
    const right = v.right - Math.max(d.right, mx), bottom = v.bottom - Math.max(d.bottom, my);
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  private viewFns = new Set<() => void>();
  /** subscribe to visible-area changes; returns the unsubscribe function */
  onView(fn: () => void): () => void { this.viewFns.add(fn); return () => this.viewFns.delete(fn); }

  layout() {
    const w = window.innerWidth, h = window.innerHeight;
    // phones and tablets only: primary pointer is touch and the physical screen is small (not a touch laptop in a tall window)
    const touch = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) <= 1024;
    this.rotated = touch && h > w * 1.1;
    const vw = this.rotated ? h : w, vh = this.rotated ? w : h; // the landscape viewport the game sees
    this.scale = Math.min(vw / DESIGN_W, vh / DESIGN_H);
    this.root.scale.set(this.scale);
    const ox = Math.round((vw - DESIGN_W * this.scale) / 2), oy = Math.round((vh - DESIGN_H * this.scale) / 2);
    if (this.rotated) {
      // rotate clockwise: design x runs down the screen, design y runs right→left
      this.root.rotation = Math.PI / 2;
      this.root.position.set(w - oy, ox);
      this.backdrop.rotation = Math.PI / 2;
      this.backdrop.position.set(w, 0);
    } else {
      this.root.rotation = 0;
      this.root.position.set(ox, oy);
      this.backdrop.rotation = 0;
      this.backdrop.position.set(0, 0);
    }
    const v = { left: -ox / this.scale, top: -oy / this.scale, right: (vw - ox) / this.scale, bottom: (vh - oy) / this.scale, width: vw / this.scale, height: vh / this.scale };
    // device insets in css px (top/right/bottom/left of the screen) → design units, following the portrait rotation
    const ins = deviceInsets();
    const s = this.scale;
    const d = this.rotated ? { top: ins.right, right: ins.bottom, bottom: ins.left, left: ins.top } : ins;
    this.insets = { top: d.top / s, right: d.right / s, bottom: d.bottom / s, left: d.left / s };
    const hud = this.hudRect(v, this.hudMargin);
    const viewChanged = Math.abs(v.width - this.view.width) > 1 || Math.abs(v.height - this.view.height) > 1
      || Math.abs(hud.left - this.hud.left) > 1 || Math.abs(hud.top - this.hud.top) > 1 || Math.abs(hud.right - this.hud.right) > 1 || Math.abs(hud.bottom - this.hud.bottom) > 1;
    this.view = v;
    this.hud = hud;
    this.fade.position.set(v.left, v.top);
    this.fade.scale.set(v.width / DESIGN_W, v.height / DESIGN_H);
    this.stageHit();
    // layout profile (ui/profile.ts); ?profile=phone|desktop forces one (testing on a desktop browser)
    const forced = new URLSearchParams(location.search).get('profile');
    const changed = setProfile(forced === 'phone' || forced === 'desktop' ? forced : pickProfile(vw, vh));
    this.compact = isPhone();
    this.fitBackdrop();
    if (changed && this.scene && this.sceneReady) this.onProfileChange?.();
    else if (viewChanged) for (const fn of [...this.viewFns]) fn();
  }

  /** set by the router: rebuild the current screen when the layout profile flips (e.g. rotating a tablet) */
  onProfileChange?: () => void;

  private stageHit() {
    this.app.stage.hitArea = this.app.screen;
  }

  private fitBackdrop() {
    const w = this.rotated ? window.innerHeight : window.innerWidth, h = this.rotated ? window.innerWidth : window.innerHeight;
    const s = this.backdropSprite;
    if (s.texture && s.texture !== Texture.EMPTY) {
      const k = Math.max(w / s.texture.width, h / s.texture.height);
      s.scale.set(k);
      s.position.set((w - s.texture.width * k) / 2, (h - s.texture.height * k) / 2);
    }
  }

  setBackdrop(tex: Texture | null, tint = 0xffffff) {
    this.backdropSprite.texture = tex ?? Texture.EMPTY;
    this.backdropSprite.tint = tint;
    this.fitBackdrop();
  }

  /** screen-space → design-space */
  toDesign(x: number, y: number) {
    // through the root transform, so it stays right when the game is drawn rotated
    const p = this.root.toLocal({ x, y });
    return { x: p.x, y: p.y };
  }

  /** top key handler first (modals), then the scene; true when something handled it */
  dispatchKey(e: KeyboardEvent): boolean {
    for (let i = this.keyHandlers.length - 1; i >= 0; i--) if (this.keyHandlers[i]!(e)) return true;
    return !!this.scene?.onKey(e);
  }
  pushKeys(fn: (e: KeyboardEvent) => boolean) { this.keyHandlers.push(fn); return () => { const i = this.keyHandlers.indexOf(fn); if (i >= 0) this.keyHandlers.splice(i, 1); }; }

  private switching = false;
  async go(next: Scene, opts: { fade?: number } = {}) {
    if (this.switching) return;
    this.switching = true;
    const dur = opts.fade ?? 280;
    this.fade.eventMode = 'static';
    await tweens.to(this.fade, { alpha: 1 }, dur, { ease: ease.inOutQuad, unscaled: true });
    if (this.scene) {
      this.scene.exit();
      this.sceneLayer.removeChild(this.scene);
      this.scene.destroy({ children: true });
    }
    this.modalLayer.removeChildren();
    this.tipLayer.removeChildren();
    this.sceneReady = false;
    this.scene = next;
    this.sceneLayer.addChild(next);
    await next.enter();
    this.sceneReady = true;
    await tweens.to(this.fade, { alpha: 0 }, dur, { ease: ease.inOutQuad, unscaled: true });
    this.fade.eventMode = 'none';
    this.switching = false;
    if (this.scene === next) await next.shown();
  }
}

/** CSS safe-area insets (px) read through a probe element; zero on devices without them */
let probe: HTMLDivElement | null = null;
function deviceInsets(): { top: number; right: number; bottom: number; left: number } {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left);';
    document.body.appendChild(probe);
  }
  const cs = getComputedStyle(probe);
  return { top: parseFloat(cs.paddingTop) || 0, right: parseFloat(cs.paddingRight) || 0, bottom: parseFloat(cs.paddingBottom) || 0, left: parseFloat(cs.paddingLeft) || 0 };
}

export const G = new GameApp();
