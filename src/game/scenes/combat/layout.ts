/**
 * Battle geometry (UI研究笔记 §14.1). All values in 1920×1080 design space.
 * Two sets: desktop (as designed) and phone (bigger units / hand for a ~0.35× screen). applyCombatLayout()
 * picks one when a battle scene is built; the exports are live bindings, so every importer sees the active set.
 */
import type { Side } from '../../../engine/combat/state';
import { isPhone } from '../../ui/profile';

interface Geometry {
  FRONT_Y: number[]; BACK_Y: number[];
  X: { playerBack: number; playerFront: number; enemyFront: number; enemyBack: number; playerCmd: number; enemyCmd: number };
  CMD_Y: number; TOKEN_W: number; TOKEN_H: number; UNIT_SCALE: number;
  HAND: { x0: number; x1: number; y: number; cardScale: number; hoverScale: number };
  PLAY_LINE_Y: number; STAGE: { x: number; y: number };
  FATE: { deck: { x: number; y: number }; discard: { x: number; y: number }; signs: { x: number; y: number }; judge: { x: number; y: number } };
  PILES: { draw: { x: number; y: number }; discard: { x: number; y: number }; exhaust: { x: number; y: number } };
  ALTAR: { x: number; y: number }; SOURCES: { x: number; y: number }; END_BTN: { x: number; y: number; w: number; h: number };
  /** commander skills row, equipment rows (player / enemy), field slots (player / enemy) */
  HUD: { skills: { x: number; y: number }; pEquip: { x: number; y: number }; eEquip: { x: number; y: number }; pField: { x: number; y: number }; eField: { x: number; y: number } };
}

const DESKTOP: Geometry = {
  // 160px pitch: a unit (frame + corner badges) is ~140px tall, so neighbours keep a visible gap
  FRONT_Y: [196, 356, 516, 676], BACK_Y: [276, 436, 596],
  X: { playerBack: 436, playerFront: 604, enemyFront: 1316, enemyBack: 1484, playerCmd: 180, enemyCmd: 1745 },
  CMD_Y: 330, TOKEN_W: 106, TOKEN_H: 126, UNIT_SCALE: 1,
  HAND: { x0: 380, x1: 1540, y: 980, cardScale: 200 / 300, hoverScale: 1.5 },
  PLAY_LINE_Y: 780, STAGE: { x: 960, y: 560 },
  FATE: { deck: { x: 960, y: 230 }, discard: { x: 1079, y: 251 }, signs: { x: 830, y: 230 }, judge: { x: 960, y: 470 } },
  PILES: { draw: { x: 70, y: 992 }, discard: { x: 1834, y: 992 }, exhaust: { x: 1708, y: 1006 } },
  ALTAR: { x: 64, y: 834 }, SOURCES: { x: 124, y: 780 }, END_BTN: { x: 1660, y: 790, w: 220, h: 80 },
  HUD: { skills: { x: 70, y: 560 }, pEquip: { x: 66, y: 650 }, eEquip: { x: 1640, y: 650 }, pField: { x: 770, y: 690 }, eField: { x: 1150, y: 690 } },
};

/** phone: units drawn 1.3× (pitch 176), columns pushed apart, hand cards 0.8 and a 1.9× focused card */
const PHONE: Geometry = {
  FRONT_Y: [176, 352, 528, 704], BACK_Y: [264, 440, 616],
  X: { playerBack: 420, playerFront: 616, enemyFront: 1304, enemyBack: 1500, playerCmd: 200, enemyCmd: 1728 },
  // commanders low enough that a boss's head and its intent clear the top bar
  CMD_Y: 372, TOKEN_W: 106, TOKEN_H: 126, UNIT_SCALE: 1.3,
  HAND: { x0: 340, x1: 1580, y: 1004, cardScale: 0.8, hoverScale: 1.9 },
  PLAY_LINE_Y: 800, STAGE: { x: 960, y: 520 },
  FATE: { deck: { x: 960, y: 210 }, discard: { x: 1086, y: 232 }, signs: { x: 822, y: 210 }, judge: { x: 960, y: 440 } },
  PILES: { draw: { x: 70, y: 988 }, discard: { x: 1834, y: 988 }, exhaust: { x: 1700, y: 1004 } },
  ALTAR: { x: 64, y: 830 }, SOURCES: { x: 124, y: 790 }, END_BTN: { x: 1630, y: 790, w: 260, h: 96 },
  HUD: { skills: { x: 70, y: 598 }, pEquip: { x: 66, y: 700 }, eEquip: { x: 1630, y: 700 }, pField: { x: 770, y: 712 }, eField: { x: 1150, y: 712 } },
};

export let FRONT_Y = DESKTOP.FRONT_Y;
export let BACK_Y = DESKTOP.BACK_Y;
export let X = DESKTOP.X;
export let CMD_Y = DESKTOP.CMD_Y;
export let TOKEN_W = DESKTOP.TOKEN_W;
export let TOKEN_H = DESKTOP.TOKEN_H;
/** units (token + badges + intents + statuses) are drawn at this scale */
export let UNIT_SCALE = DESKTOP.UNIT_SCALE;
export let HAND = DESKTOP.HAND;
export let PLAY_LINE_Y = DESKTOP.PLAY_LINE_Y;
export let STAGE = DESKTOP.STAGE;
export let FATE = DESKTOP.FATE;
export let PILES = DESKTOP.PILES;
export let ALTAR = DESKTOP.ALTAR;
export let SOURCES = DESKTOP.SOURCES;
export let END_BTN = DESKTOP.END_BTN;
export let HUD = DESKTOP.HUD;

/**
 * Select the geometry for the current profile and anchor it to the visible screen (call before building a battle
 * scene). Board and fate stay centred; the hand/piles/tray/end button hug the bottom edge, the left HUD the left
 * edge and the right HUD the right edge, so a taller or wider window has no dead bands at its borders.
 * view: HUD safe area in design coordinates (G.hud).
 */
export function applyCombatLayout(view = { left: 0, top: 0, right: 1920, bottom: 1080 }) {
  const g = isPhone() ? PHONE : DESKTOP;
  const dl = Math.min(0, view.left), dr = Math.max(0, view.right - 1920), db = Math.max(0, view.bottom - 1080);
  const BL = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + dl, y: p.y + db });
  const BR = <T extends { x: number; y: number }>(p: T): T => ({ ...p, x: p.x + dr, y: p.y + db });
  ({ FRONT_Y, BACK_Y, X, CMD_Y, TOKEN_W, TOKEN_H, UNIT_SCALE, STAGE, FATE } = g);
  X = { ...g.X, playerCmd: g.X.playerCmd + dl, enemyCmd: g.X.enemyCmd + dr };
  HAND = { ...g.HAND, y: g.HAND.y + db };
  PLAY_LINE_Y = g.PLAY_LINE_Y + db;
  PILES = { draw: BL(g.PILES.draw), discard: BR(g.PILES.discard), exhaust: BR(g.PILES.exhaust) };
  ALTAR = BL(g.ALTAR);
  SOURCES = BL(g.SOURCES);
  END_BTN = BR(g.END_BTN);
  HUD = {
    skills: { ...g.HUD.skills, x: g.HUD.skills.x + dl }, pEquip: { ...g.HUD.pEquip, x: g.HUD.pEquip.x + dl },
    eEquip: { ...g.HUD.eEquip, x: g.HUD.eEquip.x + dr }, pField: g.HUD.pField, eField: g.HUD.eField,
  };
  BOTTOM = 1080 + db;
  LEFT = dl;
  RIGHT = 1920 + dr;
}

/** visible bottom / left / right edges in design space for the active battle */
export let BOTTOM = 1080;
export let LEFT = 0;
export let RIGHT = 1920;

export function slotPos(side: Side, row: 'front' | 'back' | 'cmd', slot: number): { x: number; y: number } {
  if (row === 'cmd') return { x: side === 'player' ? X.playerCmd : X.enemyCmd, y: CMD_Y };
  const x = side === 'player' ? (row === 'front' ? X.playerFront : X.playerBack) : (row === 'front' ? X.enemyFront : X.enemyBack);
  const y = row === 'front' ? FRONT_Y[slot] ?? 400 : BACK_Y[slot] ?? 400;
  return { x, y };
}
