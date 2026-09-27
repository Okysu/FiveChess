/** 设置 (UI研究笔记 §14.8) as a modal usable anywhere, including mid-combat. */
import { Container, Text, type FederatedPointerEvent } from 'pixi.js';
import { fs } from '../ui/profile';
import { uiSprite, nine, hitRect, setColorGlyphs, dim } from '../ui/skin';
import { Button, Modal } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE } from '../ui/theme';
import { session, defaultSettings } from '../state';
import { G } from '../core/app';
import { sfx } from '../audio/audio';
import { isFullscreen, isMobileApp, isNativeApp, setFullscreen } from '../platform';
import { APP_VERSION } from '../version';

type Tab = 'general' | 'combat' | 'display' | 'audio' | 'access';

export function openSettings() {
  const m = new Modal(1500, 900, { title: '设置' });
  let tab: Tab = 'combat';
  const tabsBox = new Container();
  const body = new Container();
  m.body.addChild(tabsBox, body);
  const tabs: [Tab, string][] = [['general', '通用'], ['combat', '战斗'], ['display', '显示'], ['audio', '音频'], ['access', '辅助']];
  const render = () => {
    tabsBox.removeChildren().forEach((c) => c.destroy({ children: true }));
    tabs.forEach(([k, name], i) => {
      const b = new Button(name, { width: 200, height: 64, kind: k === tab ? 'primary' : 'ghost', onClick: () => { tab = k; render(); } });
      b.position.set(40, 110 + i * 80);
      tabsBox.addChild(b);
    });
    body.removeChildren().forEach((c) => c.destroy({ children: true }));
    const st = session.settings;
    let y = 110;
    const row = (label: string, ctrl: Container, hint?: string) => {
      const t = new Text({ text: label, style: { fontFamily: FONT_BODY, fontSize: fs(26), fill: C.text } });
      t.position.set(290, y + 14);
      ctrl.position.set(760, y);
      body.addChild(t, ctrl);
      if (hint) { const h = new Text({ text: hint, style: { fontFamily: FONT_BODY, fontSize: fs(17), fill: C.textDim } }); h.position.set(290, y + 50); body.addChild(h); y += 22; }
      y += 84;
    };
    const save = () => { void session.saveSettings(); };
    if (tab === 'combat') {
      row('演出速度', seg(['1.0×', '1.5×', '2.0×'], [1, 1.5, 2].indexOf(st.animSpeed), (i) => { st.animSpeed = [1, 1.5, 2][i]!; save(); }));
      row('精简演出', toggle(st.skipAnims, (v) => { st.skipAnims = v; save(); }), '跳过非关键动画（判定翻牌与应对窗口仍保留）');
      row('快速判定', toggle(st.fastJudge, (v) => { st.fastJudge = v; save(); }));
      row('应对询问', seg(['总是', '智能', '从不'], ['always', 'smart', 'never'].indexOf(st.responseMode), (i) => { st.responseMode = (['always', 'smart', 'never'] as const)[i]!; save(); }), '智能：仅当应对可能改变结果时才打开窗口');
      row('应对倒计时', seg(['5秒', '8秒', '12秒', '无限'], [5, 8, 12, 0].indexOf(st.responseTimer), (i) => { st.responseTimer = [5, 8, 12, 0][i]!; save(); }));
      row('结束回合前确认', toggle(st.confirmEndTurn, (v) => { st.confirmEndTurn = v; save(); }), '仍有可用行动时二次确认');
      row('新手提示', toggle(st.tutorialHints, (v) => { st.tutorialHints = v; save(); }));
    } else if (tab === 'audio') {
      row('主音量', slider(st.volume.master, (v) => { st.volume.master = v; save(); }));
      row('音乐', slider(st.volume.music, (v) => { st.volume.music = v; save(); }));
      row('音效', slider(st.volume.sfx, (v) => { st.volume.sfx = v; save(); sfx('click'); }));
      row('环境音', slider(st.volume.ambient, (v) => { st.volume.ambient = v; save(); }));
    } else if (tab === 'display') {
      row('屏幕震动', seg(['关', '弱', '标准'], [0, 0.5, 1].indexOf(st.screenShake), (i) => { st.screenShake = [0, 0.5, 1][i]!; save(); }));
      row('伤害数字', toggle(st.damageNumbers, (v) => { st.damageNumbers = v; save(); }));
      if (!isMobileApp) row('全屏', toggle(isFullscreen(), (v) => setFullscreen(v)));
      const hudRow = new Container();
      const val = new Text({ text: `${(st.hudMargin * 100).toFixed(1).replace(/\.0$/, '')}%`, style: { fontFamily: FONT_BODY, fontSize: fs(26), fill: C.goldLight } });
      val.position.set(0, 14);
      const cal = new Button('校准', { width: 160, height: 60, fontSize: fs(24), onClick: () => openHudCalibration(() => { val.text = `${(st.hudMargin * 100).toFixed(1).replace(/\.0$/, '')}%`; }) });
      cal.position.set(110, 0);
      hudRow.addChild(val, cal);
      row('HUD 安全区', hudRow, '屏幕边缘被圆角、刘海或电视过扫描遮挡时，把界面向内收');
    } else if (tab === 'access') {
      row('命纹显示文字', toggle(st.suitText, (v) => { st.suitText = v; save(); }), '在命纹图标角落加“日/雷/月/山”汉字（命纹本身已是色 + 形双编码）');
      row('色觉模式', seg(['标准', '红绿', '蓝黄'], ['none', 'rg', 'by'].indexOf(st.colorblind), (i) => { st.colorblind = (['none', 'rg', 'by'] as const)[i]!; setColorGlyphs(st.colorblind !== 'none'); save(); }), '开启后，源与命纹上额外标注“赤玄青金紫素 / 日雷月山”字样，不再只靠颜色区分');
    } else {
      const note = new Text({ text: '快捷键：空格/E 结束回合（应对窗口中为“不应对”） · 1–0 选择手牌 · D 牌组 · A 抽牌堆 · S 弃牌堆 · L 战报 · Esc 取消/设置 · 右键 检视', style: { fontFamily: FONT_BODY, fontSize: fs(20), fill: C.textDim, wordWrap: true, wordWrapWidth: 1100, breakWords: true } });
      note.position.set(290, y);
      body.addChild(note);
      y += 110;
      const logBtn = new Button('更新日志', { width: 220, height: 64, onClick: () => void import('../ui/changelog').then((c) => c.openChangelog()) });
      logBtn.position.set(290, y);
      const ver = new Text({ text: `当前版本 ${APP_VERSION}`, style: { fontFamily: FONT_BODY, fontSize: fs(22), fill: C.textDim } });
      ver.position.set(540, y + 18);
      body.addChild(logBtn, ver);
      if (isNativeApp) {
        const chk = new Button('检查更新', { width: 220, height: 64, onClick: () => void import('../updateCheck').then((u) => u.runUpdateCheck(true)) });
        chk.position.set(860, y);
        body.addChild(chk);
      }
      y += 90;
      const reset = new Button('恢复默认设置', { width: 280, height: 64, kind: 'ghost', onClick: () => { session.settings = { ...defaultSettings(), lastSeenVersion: session.settings.lastSeenVersion }; save(); render(); } });
      reset.position.set(290, y);
      body.addChild(reset);
      y += 100;
      if (session.run) {
        const ab = new Button('放弃本次冒险', { width: 280, height: 64, kind: 'danger', onClick: () => {
          const c = new Modal(700, 320, { title: '确定放弃？' });
          const t = new Text({ text: '本次冒险将按当前进度结算。', style: { fontFamily: FONT_BODY, fontSize: fs(24), fill: C.text } });
          t.position.set(60, 110);
          const yes = new Button('放弃', { width: 220, height: 64, kind: 'danger', onClick: () => { c.close(); m.close(); session.abandon(); void import('./title').then((mm) => G.go(new mm.TitleScene())); } });
          yes.position.set(80, 200);
          const no = new Button('取消', { width: 220, height: 64, kind: 'ghost', onClick: () => c.close() });
          no.position.set(380, 200);
          c.body.addChild(t, yes, no);
        } });
        ab.position.set(290, y);
        const home = new Button('保存并返回标题', { width: 280, height: 64, onClick: () => { m.close(); void session.saveRun(); void import('./title').then((mm) => G.go(new mm.TitleScene())); } });
        home.position.set(600, y);
        body.addChild(ab, home);
      }
    }
  };
  render();
}

/**
 * Console-style HUD calibration: four corner marks sit on the edge of the HUD safe area; the player shrinks the
 * area until all four are fully visible. Applies live (every edge-anchored element follows G.hud).
 */
export function openHudCalibration(onDone?: () => void) {
  const st = session.settings;
  const ov = new Container();
  const v = G.view;
  ov.addChild(dim(v.width, v.height, 0.85, v.left, v.top), hitRect(v.left, v.top, v.width, v.height));
  const marks = new Container();
  ov.addChild(marks);
  const pct = new Text({ text: '', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(56), fill: C.goldLight, stroke: { color: 0, width: 6 } } });
  pct.anchor.set(0.5);
  pct.position.set(960, 470);
  const tip = new Text({ text: '调整边距，直到四个角的标记都完整可见', style: { fontFamily: FONT_BODY, fontSize: fs(28), fill: C.text, stroke: { color: 0, width: 4 } } });
  tip.anchor.set(0.5);
  tip.position.set(960, 390);
  ov.addChild(pct, tip);
  let margin = st.hudMargin;
  const draw = () => {
    marks.removeChildren().forEach((c) => c.destroy({ children: true }));
    const h = G.hudRect(G.view, margin); // preview only; applied on 完成
    // generated corner ornament, rotated into each corner of the safe area
    ([[h.left, h.top, 0], [h.right, h.top, Math.PI / 2], [h.right, h.bottom, Math.PI], [h.left, h.bottom, -Math.PI / 2]] as const).forEach(([x, y, r]) => {
      const m = uiSprite('cloud_corner', 150, 150);
      const c = new Container();
      m.position.set(75, 75);
      c.addChild(m);
      c.position.set(x, y);
      c.rotation = r;
      marks.addChild(c);
    });
    pct.text = `边距 ${(margin * 100).toFixed(1).replace(/\.0$/, '')}%`;
  };
  const set = (m: number) => { margin = Math.round(Math.max(0, Math.min(0.1, m)) * 200) / 200; draw(); };
  const minus = new Button('－ 外扩', { width: 220, height: 72, fontSize: fs(28), onClick: () => set(margin - 0.005) });
  const plus = new Button('＋ 内收', { width: 220, height: 72, fontSize: fs(28), onClick: () => set(margin + 0.005) });
  const reset = new Button('重置', { width: 160, height: 72, fontSize: fs(26), kind: 'ghost', onClick: () => set(0) });
  const ok = new Button('完成', { width: 220, height: 72, fontSize: fs(28), kind: 'primary', onClick: () => {
    st.hudMargin = margin;
    void session.saveSettings();
    ov.destroy({ children: true });
    onDone?.();
    G.setHudMargin(margin); // edge-anchored UI moves now (open screens re-fit / rebuild once dialogs close)
  } });
  minus.position.set(960 - 470, 560); plus.position.set(960 - 230, 560); reset.position.set(960 + 10, 560); ok.position.set(960 + 190, 560);
  ov.addChild(minus, plus, reset, ok);
  G.modalLayer.addChild(ov);
  draw();
}

function toggle(v: boolean, on: (v: boolean) => void): Container {
  const c = new Container();
  let val = v;
  const draw = () => {
    c.removeChildren().forEach((x) => x.destroy({ children: true }));
    const t = uiSprite(val ? 'toggle_on' : 'toggle_off', 120, 60);
    t.position.set(60, 30);
    c.addChild(t, hitRect(0, 0, 120, 60));
  };
  draw();
  c.eventMode = 'static';
  c.cursor = 'pointer';
  c.on('pointertap', () => { val = !val; draw(); on(val); sfx('click'); });
  return c;
}

function seg(opts: string[], cur: number, on: (i: number) => void): Container {
  const c = new Container();
  let sel = Math.max(0, cur);
  const draw = () => {
    c.removeChildren().forEach((x) => x.destroy({ children: true }));
    opts.forEach((o, i) => {
      const b = new Button(o, { width: 140, height: 56, fontSize: fs(22), kind: i === sel ? 'primary' : 'ghost', onClick: () => { sel = i; draw(); on(i); } });
      b.position.set(i * 150, 0);
      c.addChild(b);
    });
  };
  draw();
  return c;
}

function slider(v: number, on: (v: number) => void): Container {
  const c = new Container();
  let val = v;
  const W = 440;
  const track = nine('slider_track', W, 26);
  track.position.set(0, 17);
  const knob = uiSprite('slider_knob', 40, 40);
  const t = new Text({ text: '', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: fs(24), fill: C.goldLight } });
  t.position.set(W + 28, 14);
  const draw = () => { knob.position.set(W * val, 30); t.text = `${Math.round(val * 100)}%`; };
  draw();
  const hit = hitRect(-10, 0, W + 20, 60);
  c.addChild(track, knob, t, hit);
  hit.cursor = 'pointer';
  let dragging = false;
  const set = (e: FederatedPointerEvent) => { const p = c.toLocal(e.global); val = Math.max(0, Math.min(1, p.x / W)); draw(); on(val); };
  hit.on('pointerdown', (e) => { dragging = true; set(e); });
  hit.on('globalpointermove', (e) => { if (dragging) set(e); });
  hit.on('pointerup', () => { dragging = false; });
  hit.on('pointerupoutside', () => { dragging = false; });
  return c;
}
