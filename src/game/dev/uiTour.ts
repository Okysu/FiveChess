/**
 * UI tour (dev only): visits every screen / modal, snapshots each to .cache/snaps/tour_*.png and runs generic
 * layout checks on the live display tree. Driven headless by scripts/ui-tour.ts, or by hand: window.__uiTour().
 * Checks per page:
 *   offscreen    visible text outside the 1920×1080 design area
 *   unfilled     text still showing a {var} placeholder (plain Text and rich-text sources)
 *   overlap      two visible texts overlapping by more than 35% of the smaller one
 *   blocked      something tappable whose centre hit-tests to a different, unrelated object
 *   scroll       a scroll box whose content extends past what it can scroll to
 *   error        console errors / exceptions raised while the page was shown
 */
import { Container, Rectangle, Text, type ContainerChild } from 'pixi.js';
import { G, type Scene } from '../core/app';
import { session } from '../state';
import { go } from '../router';
import { content } from '../../engine/content';
import { availableNodes, makeShop, rollLieutenants, runAct } from '../../engine/run/run';
import { ScrollBox } from '../ui/scroll';

export interface TourIssue { kind: 'offscreen' | 'unfilled' | 'overlap' | 'blocked' | 'scroll' | 'error'; detail: string }
export interface TourPage { name: string; issues: TourIssue[] }

const errors: string[] = [];
let hooked = false;
function hookErrors() {
  if (hooked) return;
  hooked = true;
  const orig = console.error.bind(console);
  console.error = (...a: unknown[]) => { errors.push(a.map(String).join(' ').slice(0, 300)); orig(...a); };
  window.addEventListener('error', (e) => errors.push(String(e.message)));
  window.addEventListener('unhandledrejection', (e) => errors.push(String((e as PromiseRejectionEvent).reason).slice(0, 300)));
}

const pump = async (ms: number) => {
  let now = performance.now();
  const end = now + ms;
  while (now < end) { now += 16; G.app.ticker.update(now); await new Promise((r) => setTimeout(r, 0)); }
};
const snap = async (name: string) => {
  G.app.render();
  await fetch(`/__snap?name=tour_${name}`, { method: 'POST', body: G.app.canvas.toDataURL('image/png') });
};

function visible(o: ContainerChild): boolean {
  for (let x: Container | null = o; x; x = x.parent) if (!x.visible || x.alpha < 0.05 || x.renderable === false) return false;
  return true;
}
function walk(root: Container, out: ContainerChild[] = []): ContainerChild[] {
  for (const c of root.children) { out.push(c); if (c instanceof Container && c.children.length) walk(c, out); }
  return out;
}
/** design-space bounds */
function dBounds(o: ContainerChild): Rectangle {
  const b = o.getBounds();
  const p0 = G.toDesign(b.x, b.y), p1 = G.toDesign(b.x + b.width, b.y + b.height);
  return new Rectangle(Math.min(p0.x, p1.x), Math.min(p0.y, p1.y), Math.abs(p1.x - p0.x), Math.abs(p1.y - p0.y));
}
function inScroll(o: ContainerChild): boolean { for (let x = o.parent; x; x = x.parent) if (x instanceof ScrollBox) return true; return false; }
const label = (o: ContainerChild) => (o instanceof Text ? `"${o.text.slice(0, 24)}"` : o.constructor.name);

function checkPage(): TourIssue[] {
  const issues: TourIssue[] = [];
  // an open modal covers the scene: check only what the player can actually see
  const roots = (G.modalLayer.children.length ? [G.modalLayer, G.tipLayer] : [G.sceneLayer, G.tipLayer]) as Container[];
  const all = roots.flatMap((r) => walk(r)).filter(visible);
  const texts = all.filter((o): o is Text => o instanceof Text && o.text.trim().length > 0);
  for (const t of texts) {
    if (/\{[a-z]\w*\}/.test(t.text)) issues.push({ kind: 'unfilled', detail: `${label(t)} shows a {var} placeholder` });
    if (inScroll(t)) continue;
    const b = dBounds(t);
    if (b.x < -4 || b.y < -4 || b.x + b.width > 1924 || b.y + b.height > 1084) issues.push({ kind: 'offscreen', detail: `${label(t)} at ${b.x | 0},${b.y | 0} ${b.width | 0}×${b.height | 0}` });
  }
  // overlapping texts (ignore a text over itself / its own shadow copy / hidden-by-mask scroll content)
  const inner = (t: Text) => { const b = dBounds(t); const k = 0.15; return new Rectangle(b.x + b.width * k, b.y + b.height * k, b.width * (1 - 2 * k), b.height * (1 - 2 * k)); };
  const tb = texts.filter((t) => !inScroll(t)).map((t) => ({ t, b: inner(t) }));
  for (let i = 0; i < tb.length; i++) for (let j = i + 1; j < tb.length; j++) {
    const a = tb[i]!, c = tb[j]!;
    if (a.t.text === c.t.text) continue;
    const ix = Math.max(0, Math.min(a.b.right, c.b.right) - Math.max(a.b.x, c.b.x));
    const iy = Math.max(0, Math.min(a.b.bottom, c.b.bottom) - Math.max(a.b.y, c.b.y));
    const small = Math.min(a.b.width * a.b.height, c.b.width * c.b.height);
    if (small > 60 && (ix * iy) / small > 0.35) issues.push({ kind: 'overlap', detail: `${label(a.t)} overlaps ${label(c.t)}` });
  }
  // tappable things must receive their own taps
  const boundary = G.app.renderer.events.rootBoundary;
  boundary.rootTarget = G.app.stage; // unset until the first real pointer event
  const tappable = all.filter((o) => o.eventMode === 'static' && (o.listenerCount('pointertap') > 0 || o.listenerCount('pointerdown') > 0) && !inScroll(o));
  for (const o of tappable) {
    const b = o.getBounds();
    if (b.width < 4 || b.height < 4) continue;
    // full-screen backdrops (tap outside to close) are covered by their own dialog on purpose
    if (b.width * b.height > G.app.screen.width * G.app.screen.height * 0.6) continue;
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    if (cx < 0 || cy < 0 || cx > G.app.screen.width || cy > G.app.screen.height) continue;
    const hit = boundary.hitTest(cx, cy);
    let ok = false;
    for (let x: Container | null = hit; x; x = x.parent) if (x === o) { ok = true; break; }
    // a child of the tappable or a full-screen modal dimmer above it are both fine
    if (!ok && hit && !(o instanceof Container && hit.parent && isAncestor(o, hit))) {
      if (!G.modalLayer.children.length || isAncestor(G.modalLayer, o)) issues.push({ kind: 'blocked', detail: `${label(o)} at ${(G.toDesign(cx, cy).x) | 0},${(G.toDesign(cx, cy).y) | 0} is covered by ${label(hit)}` });
    }
  }
  // scroll boxes: everything inside must be scrollable into view
  for (const s of all.filter((o): o is ScrollBox => o instanceof ScrollBox)) {
    const m = s.content.mask;
    s.content.mask = null;
    const b = s.content.getLocalBounds();
    s.content.mask = m;
    const need = s.horizontal ? b.x + b.width : b.y + b.height;
    if (need > s.contentSize + 2) issues.push({ kind: 'scroll', detail: `scroll box content ${need | 0}px but scrollable to ${s.contentSize | 0}px` });
  }
  for (const e of errors.splice(0)) issues.push({ kind: 'error', detail: e });
  // one issue per text/detail is enough
  return issues.filter((x, i, arr) => arr.findIndex((y) => y.kind === x.kind && y.detail === x.detail) === i);
}
function isAncestor(a: Container, b: Container): boolean { for (let x: Container | null = b; x; x = x.parent) if (x === a) return true; return false; }

async function page(name: string, pages: TourPage[], show: () => Promise<unknown> | unknown, settle = 1500) {
  try { await show(); } catch (e) { errors.push(`show ${name}: ${(e as Error).message}`); }
  await pump(settle);
  await snap(name);
  let issues: TourIssue[];
  try { issues = checkPage(); } catch (e) { issues = [{ kind: 'error', detail: `checker crashed: ${(e as Error).message}` }]; }
  pages.push({ name, issues });
}
async function scene(make: () => Promise<Scene>) { const s = await make(); const p = G.go(s); await pump(1200); await p; }
async function route() { const p = go(true); await pump(1200); await p; }
function closeModals() { for (const m of [...G.modalLayer.children]) (m as Container & { close?: () => void }).close?.(); G.modalLayer.removeChildren(); G.tipLayer.removeChildren(); }

export async function runUiTour(o: { events?: 'all' | number } = {}): Promise<TourPage[]> {
  hookErrors();
  errors.length = 0;
  // never touch the player's real save
  session.saveRun = async () => undefined;
  session.saveProfile = async () => undefined;
  const pages: TourPage[] = [];
  const c = content();

  await page('title', pages, () => scene(async () => new (await import('../scenes/title')).TitleScene()));
  await page('settings', pages, async () => (await import('../scenes/settings')).openSettings());
  closeModals();
  await page('credits', pages, () => (G.scene as unknown as { credits(): void }).credits(), 2500);
  closeModals();
  await page('select', pages, () => scene(async () => new (await import('../scenes/select')).SelectScene()));
  for (const tab of ['cards', 'enemies', 'relics', 'commanders', 'fate', 'world', 'rules', 'history'] as const) {
    await page(`codex_${tab}`, pages, async () => {
      if (!(G.scene?.constructor.name === 'CodexScene')) await scene(async () => new (await import('../scenes/codex')).CodexScene());
      const panel = walk(G.sceneLayer).find((x) => x.constructor.name === 'CodexPanel') as unknown as { tab: string; render(): void } | undefined;
      if (panel) { panel.tab = tab; panel.render(); }
    });
  }

  // a fresh run
  session.profile.tutorialDone = true;
  session.startRun('r_huojin', 0, 'UITOUR');
  const r = session.run!;
  runAct(r, { t: 'proceed' });
  await page('map_start', pages, route);
  const first = availableNodes(r).find((n) => n.type === 'combat')!;
  runAct(r, { t: 'go', row: first.row, col: first.col });
  await page('combat', pages, route, 6000);
  closeModals();
  const hud = await import('../ui/hud');
  await page('combat_hover', pages, () => { const cs = G.scene as unknown as { hand: { views: unknown[]; setHover(v: unknown): void } }; cs.hand.setHover(cs.hand.views[cs.hand.views.length - 1]); }, 800);
  await page('inspect_card', pages, () => hud.inspectCard('g_heartwood_pendant', false));
  closeModals();
  await page('deck', pages, () => hud.openDeck(r.deck, '牌组'));
  closeModals();

  const set = async (name: string, screen: typeof r.screen) => { r.screen = screen; session.combat = null; await page(name, pages, route); closeModals(); };
  await set('reward', { k: 'reward', items: [{ k: 'gold', n: 25, taken: false }, { k: 'relic', id: [...c.relics.keys()][3]!, taken: false }, { k: 'potion', id: [...c.potions.keys()][0]!, taken: false }, { k: 'cards', options: [{ id: 'r_basic_strike', up: false }, { id: 'g_heartwood_pendant', up: false }, { id: 'b_basic_guard', up: true }], taken: false }] } as never);
  await set('boss_relic', { k: 'bossRelic', options: [...c.relics.values()].filter((x) => x.tier === 'boss').slice(0, 3).map((x) => x.id) });
  await set('shop', { k: 'shop', shop: makeShop(r) });
  await set('camp', { k: 'camp', done: false });
  await set('recruit', { k: 'recruit', options: rollLieutenants(r), done: false });
  await set('stargaze', { k: 'stargaze', done: false });
  await set('chest', { k: 'chest', relic: [...c.relics.keys()][0]!, gold: 30, opened: true });
  await set('pick', { k: 'pick', kind: 'upgrade', n: 1, optional: false, source: 'camp' });
  const evs = [...c.events.values()];
  const evList = o.events === 'all' ? evs : evs.slice(0, typeof o.events === 'number' ? o.events : 6);
  for (const ev of evList) await set(`event_${ev.id}`, { k: 'event', id: ev.id, page: null });
  // map deep into the act (row 8 → rows past the first screen)
  r.pos = { row: 8, col: r.map.rows[8]![0]!.col };
  await set('map_row9', { k: 'map' } as never);
  r.result = 'win';
  await set('victory', { k: 'victory' });
  r.result = 'lose';
  await set('defeat', { k: 'defeat' });
  return pages;
}

export function tourSummary(pages: TourPage[]): string {
  const bad = pages.filter((p) => p.issues.length);
  const lines = [`UI tour: ${pages.length} pages, ${bad.length} with issues, ${bad.reduce((a, p) => a + p.issues.length, 0)} issues`];
  for (const p of bad) { lines.push(`■ ${p.name}`); for (const i of p.issues.slice(0, 12)) lines.push(`   ${i.kind.padEnd(9)} ${i.detail}`); if (p.issues.length > 12) lines.push(`   … ${p.issues.length - 12} more`); }
  return lines.join('\n');
}
