/** Pixi application shell: design-space scaling, layers, scene manager, keyboard routing. */
import { Application, Container, Sprite, Texture } from 'pixi.js';
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
    this.layout();
    this.app.ticker.add((t) => {
      tweens.update(t.deltaMS);
      // a scene only ticks once enter() has built it (enter awaits asset loads)
      if (this.sceneReady) this.scene?.update(t.deltaMS);
    });
    window.addEventListener('keydown', (e) => {
      for (let i = this.keyHandlers.length - 1; i >= 0; i--) if (this.keyHandlers[i]!(e)) { e.preventDefault(); return; }
      if (this.scene?.onKey(e)) e.preventDefault();
    });
  }

  layout() {
    const w = window.innerWidth, h = window.innerHeight;
    this.scale = Math.min(w / DESIGN_W, h / DESIGN_H);
    this.root.scale.set(this.scale);
    this.root.position.set(Math.round((w - DESIGN_W * this.scale) / 2), Math.round((h - DESIGN_H * this.scale) / 2));
    this.stageHit();
    this.compact = h < 500;
    this.fitBackdrop();
  }

  private stageHit() {
    this.app.stage.hitArea = this.app.screen;
  }

  private fitBackdrop() {
    const w = window.innerWidth, h = window.innerHeight;
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
    return { x: (x - this.root.x) / this.scale, y: (y - this.root.y) / this.scale };
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

export const G = new GameApp();
