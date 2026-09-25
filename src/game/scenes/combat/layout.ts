/** Battle geometry (UI研究笔记 §14.1). All values in 1920×1080 design space. */
import type { Side } from '../../../engine/combat/state';

export const FRONT_Y = [216, 362, 508, 654];
export const BACK_Y = [289, 435, 581];
export const X = {
  playerBack: 436, playerFront: 604, enemyFront: 1316, enemyBack: 1484,
  playerCmd: 180, enemyCmd: 1745,
};
export const CMD_Y = 330;
export const TOKEN_W = 112;
export const TOKEN_H = 136;

export function slotPos(side: Side, row: 'front' | 'back' | 'cmd', slot: number): { x: number; y: number } {
  if (row === 'cmd') return { x: side === 'player' ? X.playerCmd : X.enemyCmd, y: CMD_Y };
  const x = side === 'player' ? (row === 'front' ? X.playerFront : X.playerBack) : (row === 'front' ? X.enemyFront : X.enemyBack);
  const y = row === 'front' ? FRONT_Y[slot] ?? 400 : BACK_Y[slot] ?? 400;
  return { x, y };
}

export const HAND = { x0: 380, x1: 1540, y: 980, cardScale: 200 / 300, hoverScale: 1.5 };
export const PLAY_LINE_Y = 780;
export const STAGE = { x: 960, y: 560 };
export const FATE = { deck: { x: 960, y: 230 }, discard: { x: 1079, y: 251 }, signs: { x: 830, y: 230 }, judge: { x: 960, y: 470 } };
export const PILES = { draw: { x: 70, y: 992 }, discard: { x: 1834, y: 992 }, exhaust: { x: 1708, y: 1006 } };
export const ALTAR = { x: 64, y: 834 };
export const SOURCES = { x: 124, y: 780 };
export const END_BTN = { x: 1660, y: 790, w: 220, h: 80 };
