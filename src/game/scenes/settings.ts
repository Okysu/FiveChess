/** 设置 (UI研究笔记 §14.8) as a modal usable anywhere, including mid-combat. */
import { Container, Text, type FederatedPointerEvent } from 'pixi.js';
import { uiSprite, nine, hitRect, setColorGlyphs } from '../ui/skin';
import { Button, Modal } from '../ui/widgets';
import { C, FONT_BODY, FONT_TITLE } from '../ui/theme';
import { session, defaultSettings } from '../state';
import { G } from '../core/app';
import { sfx } from '../audio/audio';

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
      const t = new Text({ text: label, style: { fontFamily: FONT_BODY, fontSize: 26, fill: C.text } });
      t.position.set(290, y + 14);
      ctrl.position.set(760, y);
      body.addChild(t, ctrl);
      if (hint) { const h = new Text({ text: hint, style: { fontFamily: FONT_BODY, fontSize: 17, fill: C.textDim } }); h.position.set(290, y + 50); body.addChild(h); y += 22; }
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
      row('全屏', toggle(!!document.fullscreenElement, (v) => { if (v) void document.documentElement.requestFullscreen?.(); else void document.exitFullscreen?.(); }));
    } else if (tab === 'access') {
      row('命纹显示文字', toggle(st.suitText, (v) => { st.suitText = v; save(); }), '在命纹图标角落加“日/雷/月/山”汉字（命纹本身已是色 + 形双编码）');
      row('色觉模式', seg(['标准', '红绿', '蓝黄'], ['none', 'rg', 'by'].indexOf(st.colorblind), (i) => { st.colorblind = (['none', 'rg', 'by'] as const)[i]!; setColorGlyphs(st.colorblind !== 'none'); save(); }), '开启后，源与命纹上额外标注“赤玄青金紫素 / 日雷月山”字样，不再只靠颜色区分');
    } else {
      const note = new Text({ text: '快捷键：空格/E 结束回合（应对窗口中为“不应对”） · 1–0 选择手牌 · D 牌组 · A 抽牌堆 · S 弃牌堆 · L 战报 · Esc 取消/设置 · 右键 检视', style: { fontFamily: FONT_BODY, fontSize: 20, fill: C.textDim, wordWrap: true, wordWrapWidth: 1100, breakWords: true } });
      note.position.set(290, y);
      body.addChild(note);
      y += 110;
      const reset = new Button('恢复默认设置', { width: 280, height: 64, kind: 'ghost', onClick: () => { session.settings = defaultSettings(); save(); render(); } });
      reset.position.set(290, y);
      body.addChild(reset);
      y += 100;
      if (session.run) {
        const ab = new Button('放弃本次冒险', { width: 280, height: 64, kind: 'danger', onClick: () => {
          const c = new Modal(700, 320, { title: '确定放弃？' });
          const t = new Text({ text: '本次冒险将按当前进度结算。', style: { fontFamily: FONT_BODY, fontSize: 24, fill: C.text } });
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
      const b = new Button(o, { width: 140, height: 56, fontSize: 22, kind: i === sel ? 'primary' : 'ghost', onClick: () => { sel = i; draw(); on(i); } });
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
  const t = new Text({ text: '', style: { fontFamily: FONT_TITLE, fontWeight: '900', fontSize: 24, fill: C.goldLight } });
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
