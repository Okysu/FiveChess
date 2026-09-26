/** 地图 (UI研究笔记 §14.2): horizontal scroll, ink paths, node semantics, act intro. */
import { Container, Sprite, Text } from 'pixi.js';
import { fs } from '../ui/profile';
import { panel as uiPanel, dim as dimLayer, hitRect, uiSprite, ring as ringSprite, frame as frameSprite, maskRect } from '../ui/skin';
import { G, Scene } from '../core/app';
import { assets, K } from '../assets';
import { TopBar, actName } from '../ui/hud';
import { Button, Modal, Tooltip, hideTip, label, showTip, title, toast } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE } from '../ui/theme';
import { ScrollBox } from '../ui/scroll';
import { iconSprite } from '../ui/draw';
import { availableNodes, bossNode, type MapNode, type NodeType } from '../../engine/run/run';
import { content } from '../../engine/content';
import { session } from '../state';
import { act, go } from '../router';
import { tweens, ease } from '../core/tween';
import { audio, sfx, type MusicMood } from '../audio/audio';
import { Particles } from '../fx/fx';
import intro from '../../data/lore/intro.json';

const NODE_INFO: Record<NodeType, { name: string; desc: string; glyph: string; tint: number }> = {
  combat: { name: '战斗', desc: '与游荡的敌人交战，胜利后获得金币与卡牌。', glyph: '战', tint: 0xd8c8b0 },
  elite: { name: '精英', desc: '强大的敌人。胜利可获得遗物。', glyph: '鬼', tint: 0xe05a4a },
  event: { name: '事件', desc: '命数交错之处，福祸难料。', glyph: '？', tint: 0xd8c8b0 },
  shop: { name: '商店', desc: '购买卡牌、遗物、丹药，或付费除牌。', glyph: '钱', tint: 0xe0b060 },
  camp: { name: '营地', desc: '升级一张牌、删除一张牌，或恢复生命。', glyph: '火', tint: 0xff9a4a },
  chest: { name: '宝箱', desc: '获得一件遗物与些许金币。', glyph: '宝', tint: 0xf0d27a },
  recruit: { name: '招贤', desc: '招募一位副将：获得第三个技能与第二种颜色。', glyph: '将', tint: 0x6ad0c0 },
  stargaze: { name: '观星台', desc: '删改天命牌堆，或预览前路的具体内容。', glyph: '星', tint: 0xf0d27a },
  boss: { name: '首领', desc: '本幕首领。', glyph: '魁', tint: 0xff5a3a },
};

const ROW_W = 210;
const COL_H = 118;
const X0 = 170;
const Y0 = 190;

export class MapScene extends Scene {
  private top!: TopBar;
  private scroll!: ScrollBox;
  private pulse: { g: Container; t: number }[] = [];
  private parts = new Particles();
  private acc = 0;
  private spawn?: () => void;

  override async enter() {
    const r = session.run!;
    await assets.loadMany([K.bg(`map_${r.act}`), ...Object.keys(NODE_INFO).map((t) => K.icon(`node_${t}`))]);
    G.setBackdrop(assets.get(K.bg(`map_${r.act}`)));
    audio.playMusic(`map${Math.min(4, r.act)}` as MusicMood);
    audio.ambience((['forest', 'water', 'stars', 'void'] as const)[r.act - 1] ?? null);
    this.scroll = new ScrollBox(1920, 952, true);
    this.scroll.position.set(0, 128);
    this.addChild(this.scroll, this.parts);
    this.spawn = this.parts.ambient(r.act === 1 ? 'dust' : r.act === 2 ? 'dust' : 'stars', 1920, 1080, 0.25);
    this.drawMap();
    this.top = new TopBar(r, { onPotion: (i) => this.usePotion(i), onSettings: () => void import('./settings').then((m) => m.openSettings()), onCodex: () => void import('./codex').then((m) => m.openCodexModal()) });
    this.addChild(this.top);
    const legend = this.legend();
    legend.position.set(1920 - 316 - 20, 1080 - 336 - 16);
    this.addChild(legend);
    const title2 = new Text({ text: `第${['', '一', '二', '三', '终'][r.act]}幕 · ${actName(r.act)}`, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(40), fill: C.textDark, letterSpacing: 6 } });
    title2.position.set(40, 140);
    this.addChild(title2);
    // center on current
    const cur = r.pos?.row ?? -1;
    this.scroll.setOffset(Math.max(0, X0 + (cur + 1) * ROW_W - 700));
    if (r.screen.k === 'actStart') this.actIntro();
  }

  private nodePos(n: MapNode) {
    const r = session.run!;
    if (r.act === 4) return { x: X0 + n.row * 520 + 200, y: 520 };
    const jitterX = ((n.x * 1000) % 1) * 0;
    return { x: X0 + n.row * ROW_W + (n.x - (n.col + 0.5) / 7) * 600 + jitterX, y: Y0 + n.col * COL_H };
  }

  private drawMap() {
    const r = session.run!;
    const c = this.scroll.content;
    c.removeChildren();
    const paths = new Container();
    c.addChild(paths);
    const visited = new Set(r.history.filter((h) => h.act === r.act).map((h) => h.row));
    const onPath = (n: MapNode) => r.history.some((h) => h.act === r.act && h.row === n.row && h.col === n.col);
    const avail = availableNodes(r);
    const isAvail = (n: MapNode) => avail.some((a) => a.row === n.row && a.col === n.col);
    // paths
    for (const row of r.map.rows) for (const n of row) {
      const p = this.nodePos(n);
      for (const nc of n.next) {
        const t = r.map.rows[n.row + 1]?.find((x) => x.col === nc);
        if (!t) continue;
        const q = this.nodePos(t);
        const walked = pathTaken(r, n, t);
        dashed(paths, p.x, p.y, q.x, q.y, walked ? 6 : 3, walked ? 0x3a1a0c : 0x6a5a48, walked ? 1 : 0.55, !walked);
      }
    }
    // boss link
    const lastRow = r.map.rows[r.map.rows.length - 1] ?? [];
    const bp = r.act === 4 ? null : { x: X0 + 15 * ROW_W + 160, y: Y0 + 3 * COL_H };
    if (bp) for (const n of lastRow) { const p = this.nodePos(n); dashed(paths, p.x, p.y, bp.x, bp.y, 3, 0x6a3a2a, 0.6, true); }
    // nodes
    for (const row of r.map.rows) for (const n of row) {
      const p = this.nodePos(n);
      const info = NODE_INFO[n.type];
      const node = new Container();
      node.position.set(p.x, p.y);
      const done = onPath(n);
      const avl = isAvail(n);
      const ic = iconSprite(`node_${n.type}`, 64, info.glyph, info.tint);
      node.addChild(ic);
      if (done) {
        const stamp = uiSprite('stamp_visited', 96, 96, { alpha: 0.9 });
        node.addChild(stamp);
        ic.alpha = 0.6;
      }
      if (avl) {
        const ring = ringSprite('gold', 104);
        node.addChildAt(ring, 0);
        this.pulse.push({ g: ring, t: Math.random() * 1000 });
        node.eventMode = 'static';
        node.cursor = 'pointer';
        node.on('pointertap', () => { if (!this.scroll.wasDrag) void this.choose(n); });
      } else if (!done) node.alpha = r.pos && n.row <= r.pos.row ? 0.45 : 0.85;
      if (r.act === 1 && !r.pos && n.row === 0) node.scale.set(1.05);
      const prevKey = `${r.act}:${n.row}:${n.col}`;
      const prevLabel = r.previews[prevKey];
      node.on('pointerover', (e) => {
        if (avl) void tweens.to(node.scale, { x: 1.15, y: 1.15 }, 120, { unscaled: true });
        const lines = [{ title: info.name, body: info.desc }];
        if (prevLabel) lines.push({ title: '观星所见', body: previewText(prevLabel) });
        showTip(new Tooltip(lines, 360), G.toDesign(e.global.x, e.global.y).x + 20, 300);
      });
      node.on('pointerout', () => { void tweens.to(node.scale, { x: 1, y: 1 }, 120, { unscaled: true }); hideTip(); });
      node.eventMode = 'static';
      c.addChild(node);
      void visited;
    }
    // boss
    const bossId = r.bosses[r.act];
    const enc = bossId ? content().encounters.get(bossId) : undefined;
    const bossEnemy = enc?.enemies.map((e) => content().enemies.get(e.id)).find((e) => e?.tier === 'boss');
    if (bossEnemy) {
      const bx = r.act === 4 ? X0 + 2 * 520 + 200 : bp!.x + 120;
      const by = r.act === 4 ? 520 : bp!.y;
      const b = new Container();
      b.position.set(bx, by);
      const frame = uiPanel(260, 330, 'dark');
      frame.position.set(-130, -165);
      b.addChild(frame);
      const m = maskRect(-96, -130, 192, 262, 0);
      assets.with(K.enemy(bossEnemy.id, true), (t) => {
        const s = new Sprite(t);
        const k = 300 / t.height;
        s.scale.set(k);
        s.anchor.set(0.5, 0);
        s.position.set(0, -150);
        b.addChild(m);
        s.mask = m;
        b.addChildAt(s, 1);
      });
      const nm = new Text({ text: bossEnemy.name, style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(30), fill: 0xffc8a0, stroke: { color: 0, width: 5 } } });
      nm.anchor.set(0.5);
      nm.position.set(0, 196);
      b.addChild(nm);
      const avl = availableNodes(r).some((n) => n.type === 'boss');
      if (avl) {
        const ring = frameSprite('red', 260, 330, 12);
        ring.position.set(-142, -177);
        b.addChildAt(ring, 0);
        this.pulse.push({ g: ring, t: 0 });
        b.eventMode = 'static';
        b.cursor = 'pointer';
        b.on('pointertap', () => { if (!this.scroll.wasDrag) void this.choose(bossNode(r)); });
      }
      b.eventMode = 'static';
      b.on('pointerover', (e) => showTip(new Tooltip([{ title: bossEnemy.name, body: bossEnemy.lore }], 420), G.toDesign(e.global.x, e.global.y).x - 480, 300));
      b.on('pointerout', hideTip);
      c.addChild(b);
    }
    // final act nodes (act 4 uses the same node drawing above)
    this.scroll.refresh();
  }

  private async choose(n: MapNode) {
    hideTip();
    sfx('step');
    const err = await act({ t: 'go', row: n.row, col: n.col });
    if (err) toast(err);
  }

  private legend(): Container {
    const c = new Container();
    // the panel's carved border is ~44px: keep entries inside the plain field
    const bg = uiPanel(316, 336, 'dark');
    c.addChild(bg);
    const types: NodeType[] = ['combat', 'elite', 'event', 'shop', 'camp', 'chest', 'recruit', 'stargaze'];
    types.forEach((t, i) => {
      const x = 46 + (i % 2) * 118, y = 46 + Math.floor(i / 2) * 62;
      const ic = iconSprite(`node_${t}`, 40, NODE_INFO[t].glyph, NODE_INFO[t].tint);
      ic.position.set(x + 20, y + 20);
      const l = label(NODE_INFO[t].name, { fontSize: fs(18), fill: C.text });
      l.position.set(x + 44, y + 8);
      c.addChild(ic, l);
    });
    return c;
  }

  private actIntro() {
    const r = session.run!;
    const a = (intro as { acts: Record<string, { title: string; subtitle: string; text: string }> }).acts[String(r.act)];
    const overlay = new Container();
    const dim = new Container();
    dim.addChild(dimLayer(1920, 1080, 0.85), hitRect(0, 0, 1920, 1080));
    dim.eventMode = 'static';
    overlay.addChild(dim);
    const t = title(a?.title ?? `第${r.act}幕`, 96);
    t.anchor.set(0.5); t.position.set(960, 380);
    const st = new Text({ text: a?.subtitle ?? actName(r.act), style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(44), fill: C.text, letterSpacing: 12 } });
    st.anchor.set(0.5); st.position.set(960, 490);
    const body = new Text({ text: a?.text ?? '', style: { fontFamily: FONT_BODY, fontSize: fs(26), fill: C.textDim, wordWrap: true, wordWrapWidth: 1100, align: 'center', lineHeight: 44, breakWords: true } });
    body.anchor.set(0.5, 0); body.position.set(960, 580);
    const hint = label('点击继续', { fontSize: fs(22), fill: C.textDim });
    hint.anchor.set(0.5); hint.position.set(960, 960);
    overlay.addChild(t, st, body, hint);
    overlay.alpha = 0;
    this.addChild(overlay);
    sfx('bossIntro');
    void tweens.to(overlay, { alpha: 1 }, 700, { unscaled: true });
    dim.on('pointertap', async () => {
      await tweens.to(overlay, { alpha: 0 }, 400, { unscaled: true });
      overlay.destroy({ children: true });
      session.act({ t: 'proceed' });
      this.drawMap();
    });
  }

  private usePotion(i: number) {
    const r = session.run!;
    const id = r.potions[i];
    if (!id) return;
    const def = content().potions.get(id)!;
    const m = new Modal(640, 360, { title: def.name });
    const t = new Text({ text: def.outOfCombat ? '在地图上使用，或丢弃。' : '此物只能在战斗中使用。', style: { fontFamily: FONT_BODY, fontSize: fs(24), fill: C.text } });
    t.position.set(60, 120);
    m.body.addChild(t);
    if (def.outOfCombat) {
      const use = new Button('使用', { width: 200, height: 64, kind: 'primary', onClick: () => { session.act({ t: 'mapPotion', slot: i }); m.close(); this.top.refresh(); sfx('heal'); void go(true); } });
      use.position.set(90, 240);
      m.body.addChild(use);
    }
    const drop = new Button('丢弃', { width: 200, height: 64, kind: 'danger', onClick: () => { session.act({ t: 'discardPotion', slot: i }); m.close(); this.top.refresh(); } });
    drop.position.set(350, 240);
    m.body.addChild(drop);
  }

  override update(dt: number) {
    for (const p of this.pulse) { p.t += dt; p.g.alpha = 0.45 + 0.45 * Math.sin(p.t / 280); p.g.scale.set(1 + 0.04 * Math.sin(p.t / 280)); }
    this.acc += dt;
    while (this.acc > 80) { this.acc -= 80; this.spawn?.(); }
    this.parts.update(dt);
  }
}

function pathTaken(r: NonNullable<typeof session.run>, a: MapNode, b: MapNode): boolean {
  const hs = r.history.filter((h) => h.act === r.act);
  return hs.some((h) => h.row === a.row && h.col === a.col) && hs.some((h) => h.row === b.row && h.col === b.col);
}

function dashed(layer: Container, x1: number, y1: number, x2: number, y2: number, w: number, _color: number, alpha: number, dash: boolean) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const step = dash ? 22 : 11;
  const n = Math.max(1, Math.floor(len / step));
  for (let i = 1; i < n; i++) {
    const k = i / n;
    const d = uiSprite(dash ? 'path_dot' : 'path_dot_red', w * 2.4, w * 2.4, { alpha });
    d.position.set(x1 + (x2 - x1) * k, y1 + (y2 - y1) * k);
    layer.addChild(d);
  }
}

function previewText(id: string): string {
  const enc = content().encounters.get(id);
  if (enc) return enc.enemies.map((e) => content().enemies.get(e.id)?.name ?? e.id).join('、');
  const ev = content().events.get(id);
  return ev ? `事件：${ev.title}` : id;
}

export { ease };
