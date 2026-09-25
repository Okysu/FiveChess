/** Global game session: profile, settings, current run & combat, persistence and scene routing. */
import { newProfile, lockedContent, recordRun, runScore, type Profile, type RunSummary } from '../engine/meta';
import { newRun, runAct, combatConfig, type RunState, type RunAction } from '../engine/run/run';
import { createCombat } from '../engine/combat/api';
import type { CombatState } from '../engine/combat/state';
import { load, save, clear } from './save/db';
import { audio } from './audio/audio';
import { tweens } from './core/tween';

export interface Settings {
  volume: { master: number; music: number; sfx: number; ambient: number };
  animSpeed: number;
  skipAnims: boolean;
  fastJudge: boolean;
  responseMode: 'always' | 'smart' | 'never';
  responseTimer: number; // seconds, 0 = infinite
  confirmEndTurn: boolean;
  colorblind: 'none' | 'rg' | 'by';
  suitText: boolean;
  fontScale: number;
  screenShake: number;
  damageNumbers: boolean;
  tutorialHints: boolean;
}

export const defaultSettings = (): Settings => ({
  volume: { master: 0.8, music: 0.5, sfx: 0.8, ambient: 0.5 }, animSpeed: 1, skipAnims: false, fastJudge: false,
  responseMode: 'smart', responseTimer: 8, confirmEndTurn: false, colorblind: 'none', suitText: false, fontScale: 1,
  screenShake: 1, damageNumbers: true, tutorialHints: true,
});

interface RunSave { run: RunState; combat: CombatState | null }

class Session {
  profile: Profile = newProfile();
  settings: Settings = defaultSettings();
  run: RunState | null = null;
  combat: CombatState | null = null;
  lastUnlocks: string[] = [];
  /** router installed by main.ts */
  router: (() => void) | null = null;

  async load() {
    this.profile = (await load<Profile>('profile')) ?? newProfile();
    this.settings = { ...defaultSettings(), ...((await load<Settings>('settings')) ?? {}) };
    const rs = await load<RunSave>('run');
    if (rs && rs.run && !rs.run.result) { this.run = rs.run; this.combat = rs.combat; }
    this.applySettings();
  }

  applySettings() {
    const v = this.settings.volume;
    audio.setVolume('master', v.master);
    audio.setVolume('music', v.music);
    audio.setVolume('sfx', v.sfx);
    audio.setVolume('ambient', v.ambient);
    tweens.speed = this.settings.animSpeed;
    tweens.skip = this.settings.skipAnims;
  }

  async saveSettings() { this.applySettings(); await save('settings', this.settings); }
  async saveProfile() { await save('profile', this.profile); }
  async saveRun() { if (this.run) await save<RunSave>('run', { run: this.run, combat: this.combat }); }

  startRun(commander: string, ascension: number, seed?: string) {
    const s = seed && seed.trim() ? seed.trim() : Math.random().toString(36).slice(2, 10).toUpperCase();
    const tutorial = !this.profile.tutorialDone;
    this.run = newRun({ seed: s, commander, ascension, tutorial, locked: lockedContent(this.profile), unlockedHidden: this.profile.hiddenUnlocked });
    this.combat = null;
    void this.saveRun();
  }

  /** apply a run action and persist */
  act(a: RunAction): string | null {
    if (!this.run) return 'no run';
    const err = runAct(this.run, a);
    if (!err) void this.saveRun();
    return err;
  }

  ensureCombat(): CombatState {
    if (!this.run) throw new Error('no run');
    if (!this.combat) {
      this.combat = createCombat(combatConfig(this.run));
      void this.saveRun();
    }
    return this.combat;
  }

  finishCombat() {
    const c = this.combat;
    const r = this.run;
    if (!c || !r) return;
    const enemies = Object.values(c.units).filter((u) => u.side === 'enemy' && u.origin === 'enemy').map((u) => u.def);
    const pc = c.units[c.sides.player.commander!]!;
    runAct(r, { t: 'combatResult', result: c.over === 'win' ? 'win' : 'lose', hp: pc.hp, gold: c.goldGained, potions: c.potions, relics: c.relics, stats: c.stats, enemies: [...new Set(enemies)] });
    this.combat = null;
    if (r.result) this.endRun();
    void this.saveRun();
  }

  endRun(abandon = false) {
    const r = this.run;
    if (!r) return;
    if (abandon) r.result = 'lose';
    const summary: RunSummary = {
      seed: r.seed, commander: r.commander, lieutenant: r.lieutenant, ascension: r.ascension, result: abandon ? 'abandon' : (r.result ?? 'lose'),
      act: r.act, floor: r.floor, score: runScore(r), date: Date.now(), deck: r.deck.map((d) => d.id + (d.up ? '+' : '')),
      relics: r.relics.map((x) => x.id), nemesis: r.nemesis, turns: r.stats.turns, maxDamage: r.stats.maxDamage, log: { runLog: r.log },
    };
    this.lastUnlocks = recordRun(this.profile, r, summary);
    void this.saveProfile();
    void clear('run');
  }

  abandon() {
    this.endRun(true);
    this.run = null;
    this.combat = null;
  }
}

export const session = new Session();
