/**
 * Audio: WebAudio buses (master / music / sfx / ambient).
 * Samples come from assets/audio/audio.json (CC0 packs + project-generated files, see scripts/audio/import-audio.ts):
 * sound ids play a random variant, music moods and ambience stream from looping media elements.
 * Anything unmapped — or a file this browser can't decode — falls back to the procedural synth
 * (guqin-like plucks, stone chimes 磬, drums, whooshes) and generative pentatonic music.
 */
type Bus = 'master' | 'music' | 'sfx' | 'ambient';

class AudioSys {
  ctx: AudioContext | null = null;
  buses: Partial<Record<Bus, GainNode>> = {};
  volumes: Record<Bus, number> = { master: 0.8, music: 0.55, sfx: 0.8, ambient: 0.5 };
  private noiseBuf: AudioBuffer | null = null;
  private reverb: ConvolverNode | null = null;
  private music: MusicPlayer | null = null;
  private amb: { stop: () => void } | null = null;
  private unlocked = false;
  private bank: { sfx: Record<string, { files: string[]; gain: number }>; music: Record<string, { file: string; gain: number }>; amb: Record<string, { file: string; gain: number }> } | null = null;
  private buffers = new Map<string, AudioBuffer | 'loading' | 'failed'>();
  private stream: { key: string; el: HTMLAudioElement; g: GainNode } | null = null;
  private ambStream: { key: string; el: HTMLAudioElement; g: GainNode } | null = null;
  private base = (import.meta.env.BASE_URL ?? '/') + 'audio/';

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const master = this.ctx.createGain();
    master.connect(this.ctx.destination);
    this.buses.master = master;
    for (const b of ['music', 'sfx', 'ambient'] as Bus[]) {
      const g = this.ctx.createGain();
      g.connect(master);
      this.buses[b] = g;
    }
    this.applyVolumes();
    // noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // simple hall reverb
    this.reverb = this.ctx.createConvolver();
    const rl = this.ctx.sampleRate * 2.4;
    const ir = this.ctx.createBuffer(2, rl, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < rl; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2); }
    this.reverb.buffer = ir;
    const rg = this.ctx.createGain();
    rg.gain.value = 0.28;
    this.reverb.connect(rg);
    rg.connect(master);
    void fetch(`${this.base}audio.json`, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).then((j) => { this.bank = j; if (this.unlocked) this.preloadSfx(); }).catch(() => undefined);
    const unlock = () => {
      if (this.ctx?.state === 'suspended') void this.ctx.resume();
      if (!this.unlocked) { this.unlocked = true; this.preloadSfx(); if (this.pendingMusic) { const m = this.pendingMusic; this.pendingMusic = null; this.music?.stop(); this.music = null; this.playMusic(m); } }
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  applyVolumes() {
    for (const b of ['master', 'music', 'sfx', 'ambient'] as Bus[]) {
      const g = this.buses[b];
      if (g && this.ctx) g.gain.setTargetAtTime(this.volumes[b] * (b === 'master' ? 1 : 1), this.ctx.currentTime, 0.05);
    }
  }

  setVolume(b: Bus, v: number) { this.volumes[b] = v; this.applyVolumes(); }

  get now() { return this.ctx?.currentTime ?? 0; }

  out(bus: Bus = 'sfx', wet = 0): AudioNode {
    const g = this.ctx!.createGain();
    g.connect(this.buses[bus]!);
    if (wet > 0 && this.reverb) { const w = this.ctx!.createGain(); w.gain.value = wet; g.connect(w); w.connect(this.reverb); }
    return g;
  }

  // ───────────── primitives ─────────────
  tone(freq: number, dur: number, o: { type?: OscillatorType; vol?: number; attack?: number; bus?: Bus; wet?: number; at?: number; glide?: number; detune?: number; filter?: number } = {}) {
    if (!this.ctx) return;
    const t = (o.at ?? this.now);
    const osc = this.ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, t);
    if (o.glide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.glide), t + dur);
    if (o.detune) osc.detune.value = o.detune;
    const g = this.ctx.createGain();
    const v = o.vol ?? 0.3;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(v, t + (o.attack ?? 0.005));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    let node: AudioNode = osc;
    if (o.filter) { const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.filter; osc.connect(f); node = f; }
    node.connect(g);
    g.connect(this.out(o.bus ?? 'sfx', o.wet ?? 0));
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  noise(dur: number, o: { vol?: number; type?: BiquadFilterType; freq?: number; freqEnd?: number; q?: number; bus?: Bus; wet?: number; at?: number; attack?: number } = {}) {
    if (!this.ctx || !this.noiseBuf) return;
    const t = o.at ?? this.now;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = o.type ?? 'bandpass';
    f.frequency.setValueAtTime(o.freq ?? 1200, t);
    if (o.freqEnd) f.frequency.exponentialRampToValueAtTime(o.freqEnd, t + dur);
    f.Q.value = o.q ?? 1;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(o.vol ?? 0.3, t + (o.attack ?? 0.01));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(this.out(o.bus ?? 'sfx', o.wet ?? 0));
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  /** plucked string (guqin / pipa-like): harmonic partials with fast decay */
  pluck(freq: number, o: { vol?: number; dur?: number; bus?: Bus; at?: number; wet?: number; bright?: number } = {}) {
    const dur = o.dur ?? 1.4;
    const v = o.vol ?? 0.22;
    const br = o.bright ?? 1;
    this.tone(freq, dur, { type: 'triangle', vol: v, bus: o.bus, at: o.at, wet: o.wet ?? 0.25, filter: 2400 * br });
    this.tone(freq * 2, dur * 0.6, { type: 'sine', vol: v * 0.35, bus: o.bus, at: o.at, wet: o.wet ?? 0.25 });
    this.tone(freq * 3.01, dur * 0.3, { type: 'sine', vol: v * 0.15 * br, bus: o.bus, at: o.at });
    this.noise(0.03, { vol: v * 0.3, freq: freq * 4, q: 2, bus: o.bus, at: o.at });
  }

  /** stone chime / bell (磬): inharmonic partials, long decay */
  chime(freq: number, o: { vol?: number; dur?: number; bus?: Bus; at?: number } = {}) {
    const ratios = [1, 2.76, 5.4, 8.93];
    ratios.forEach((r, i) => this.tone(freq * r, (o.dur ?? 2.5) / (1 + i * 0.6), { type: 'sine', vol: (o.vol ?? 0.2) / (1 + i * 1.3), bus: o.bus, at: o.at, wet: 0.45 }));
  }

  drum(freq = 90, o: { vol?: number; at?: number; bus?: Bus; dur?: number } = {}) {
    this.tone(freq * 1.8, o.dur ?? 0.35, { type: 'sine', vol: o.vol ?? 0.5, glide: freq * 0.6, at: o.at, bus: o.bus, wet: 0.15 });
    this.noise(0.08, { vol: (o.vol ?? 0.5) * 0.35, freq: 500, type: 'lowpass', at: o.at, bus: o.bus });
  }

  // ───────────── samples ─────────────

  private preloadSfx() {
    if (!this.bank) return;
    for (const { files } of Object.values(this.bank.sfx)) for (const f of files) void this.decode(f);
  }

  private async decode(file: string): Promise<AudioBuffer | null> {
    const hit = this.buffers.get(file);
    if (hit === 'failed' || hit === 'loading') return null;
    if (hit) return hit;
    if (!this.ctx) return null;
    this.buffers.set(file, 'loading');
    try {
      const data = await (await fetch(this.base + file)).arrayBuffer();
      const buf = await this.ctx.decodeAudioData(data);
      this.buffers.set(file, buf);
      return buf;
    } catch {
      this.buffers.set(file, 'failed'); // e.g. no Ogg Vorbis decoder: this id keeps its synth voice
      return null;
    }
  }

  /** play a sample for a sound id; false → caller synthesizes */
  playSample(id: string, intensity = 1): boolean {
    const e = this.bank?.sfx[id];
    if (!e || !this.ctx) return false;
    const ready = e.files.map((f) => this.buffers.get(f)).filter((b): b is AudioBuffer => b instanceof AudioBuffer);
    if (!ready.length) { for (const f of e.files) void this.decode(f); return false; }
    const src = this.ctx.createBufferSource();
    src.buffer = ready[Math.floor(Math.random() * ready.length)]!;
    src.playbackRate.value = 0.96 + Math.random() * 0.08; // small pitch jitter: repeats don't sound identical
    const g = this.ctx.createGain();
    g.gain.value = e.gain * Math.min(1.4, 0.6 + intensity * 0.4);
    src.connect(g);
    g.connect(this.out('sfx', 0.08));
    src.start();
    return true;
  }

  /** looping streamed track on a bus, crossfaded; null if the file can't play here */
  private startStream(file: string, gain: number, bus: Bus): { key: string; el: HTMLAudioElement; g: GainNode } | null {
    if (!this.ctx) return null;
    const el = new Audio(this.base + file);
    el.loop = true;
    el.preload = 'auto';
    if (el.canPlayType(file.endsWith('.ogg') ? 'audio/ogg; codecs="vorbis"' : file.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav') === '') return null;
    const node = this.ctx.createMediaElementSource(el);
    const g = this.ctx.createGain();
    g.gain.value = 0;
    node.connect(g);
    g.connect(this.buses[bus]!);
    g.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.8);
    void el.play().catch(() => undefined);
    return { key: file, el, g };
  }

  private stopStream(s: { el: HTMLAudioElement; g: GainNode } | null) {
    if (!s || !this.ctx) return;
    s.g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
    setTimeout(() => { s.el.pause(); s.el.src = ''; }, 2500);
  }

  private pendingMusic: MusicMood | null = null;

  playMusic(mood: MusicMood) {
    if (!this.ctx) return;
    if (this.music?.mood === mood || this.stream?.key === `${mood}`) return;
    // browsers block media playback before the first gesture: remember the mood and start it on unlock
    if (!this.unlocked) this.pendingMusic = mood;
    const m = this.bank?.music[mood];
    // two moods can share a track (map1 / map3): keep it playing instead of restarting
    if (m && this.unlocked && this.stream?.el.src.endsWith(m.file)) { this.stream.key = mood; return; }
    const next = m && this.unlocked ? this.startStream(m.file, m.gain, 'music') : null;
    this.music?.stop();
    this.music = null;
    this.stopStream(this.stream);
    this.stream = null;
    if (next) { next.key = mood; this.stream = next; return; }
    this.music = new MusicPlayer(this, mood);
    this.music.start();
  }

  stopMusic() { this.music?.stop(); this.music = null; this.stopStream(this.stream); this.stream = null; }

  ambience(kind: 'forest' | 'water' | 'stars' | 'void' | 'fire' | null) {
    this.amb?.stop();
    this.amb = null;
    this.stopStream(this.ambStream);
    this.ambStream = null;
    const file = kind ? this.bank?.amb[kind] : undefined;
    if (file && this.unlocked) { this.ambStream = this.startStream(file.file, file.gain, 'ambient'); if (this.ambStream) return; }
    if (!kind || !this.ctx || !this.noiseBuf) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    const cfg = { forest: [600, 0.5, 'bandpass'], water: [350, 0.8, 'lowpass'], stars: [3000, 0.3, 'highpass'], void: [120, 0.9, 'lowpass'], fire: [900, 0.6, 'bandpass'] }[kind] as [number, number, BiquadFilterType];
    f.type = cfg[2]; f.frequency.value = cfg[0]; f.Q.value = cfg[1];
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(0.09, ctx.currentTime, 1.5);
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07;
    const lg = ctx.createGain(); lg.gain.value = 0.04;
    lfo.connect(lg); lg.connect(g.gain);
    src.connect(f); f.connect(g); g.connect(this.buses.ambient!);
    src.start(); lfo.start();
    this.amb = { stop: () => { g.gain.setTargetAtTime(0, ctx.currentTime, 0.5); setTimeout(() => { try { src.stop(); lfo.stop(); } catch { /* */ } }, 2000); } };
  }
}

export const audio = new AudioSys();

// ───────────── music ─────────────

export type MusicMood = 'title' | 'map1' | 'map2' | 'map3' | 'map4' | 'battle' | 'elite' | 'boss' | 'final' | 'victory' | 'defeat' | 'camp' | 'shop';

// pentatonic scales (semitones from root): 宫 gong / 羽 yu / 商 shang / 徵 zhi
const MODES = { gong: [0, 2, 4, 7, 9], yu: [0, 3, 5, 7, 10], shang: [0, 2, 5, 7, 10], zhi: [0, 2, 5, 7, 9], jue: [0, 3, 5, 8, 10] };
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

class MusicPlayer {
  private timer: number | null = null;
  private step = 0;
  private next = 0;
  private stopped = false;
  private seed = Math.random() * 1000;
  constructor(private a: AudioSys, readonly mood: MusicMood) {}

  private cfg() {
    const m = this.mood;
    const table: Record<MusicMood, { bpm: number; root: number; mode: keyof typeof MODES; drums: number; density: number; pad: number; bright: number }> = {
      title: { bpm: 62, root: 50, mode: 'yu', drums: 0, density: 0.45, pad: 0.07, bright: 0.8 },
      map1: { bpm: 70, root: 52, mode: 'shang', drums: 0, density: 0.5, pad: 0.06, bright: 0.9 },
      map2: { bpm: 64, root: 49, mode: 'yu', drums: 0, density: 0.4, pad: 0.07, bright: 0.7 },
      map3: { bpm: 72, root: 55, mode: 'gong', drums: 0, density: 0.55, pad: 0.06, bright: 1.1 },
      map4: { bpm: 56, root: 45, mode: 'jue', drums: 0, density: 0.35, pad: 0.08, bright: 0.6 },
      battle: { bpm: 104, root: 50, mode: 'yu', drums: 0.6, density: 0.6, pad: 0.05, bright: 1 },
      elite: { bpm: 112, root: 49, mode: 'jue', drums: 0.75, density: 0.65, pad: 0.05, bright: 1 },
      boss: { bpm: 120, root: 46, mode: 'jue', drums: 0.95, density: 0.7, pad: 0.06, bright: 1.1 },
      final: { bpm: 96, root: 43, mode: 'yu', drums: 0.85, density: 0.6, pad: 0.08, bright: 1.2 },
      victory: { bpm: 84, root: 55, mode: 'gong', drums: 0.3, density: 0.7, pad: 0.07, bright: 1.2 },
      defeat: { bpm: 50, root: 45, mode: 'yu', drums: 0, density: 0.3, pad: 0.06, bright: 0.5 },
      camp: { bpm: 58, root: 52, mode: 'zhi', drums: 0, density: 0.35, pad: 0.06, bright: 0.8 },
      shop: { bpm: 88, root: 57, mode: 'zhi', drums: 0.2, density: 0.55, pad: 0.04, bright: 1 },
    };
    return table[m];
  }

  private rnd() { this.seed = (this.seed * 9301 + 49297) % 233280; return this.seed / 233280; }

  start() {
    if (!this.a.ctx) return;
    this.next = this.a.now + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 100);
  }

  stop() {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
  }

  private schedule() {
    if (this.stopped || !this.a.ctx) return;
    const c = this.cfg();
    const beat = 60 / c.bpm / 2; // eighth notes
    const scale = MODES[c.mode];
    while (this.next < this.a.now + 0.4) {
      const t = this.next;
      const s = this.step;
      const bar = Math.floor(s / 16);
      const pos = s % 16;
      // chord root cycle (i – iv – v – i-ish within pentatonic)
      const prog = [0, 3, 1, 4][bar % 4]!;
      const chordRoot = c.root + scale[prog % 5]! + (prog >= 5 ? 12 : 0);
      // pad at bar start
      if (pos === 0) {
        for (const iv of [0, 7, 12]) this.a.tone(hz(chordRoot + iv - 12), beat * 16 * 1.05, { type: 'sawtooth', vol: c.pad, attack: 0.6, bus: 'music', filter: 700 * c.bright, wet: 0.5, detune: (this.rnd() - 0.5) * 12 });
      }
      // bass pluck
      if (pos % 8 === 0) this.a.pluck(hz(chordRoot - 12), { vol: 0.16, dur: 1.8, bus: 'music', at: t, bright: 0.6 });
      // melody (guqin-like) walking the pentatonic
      if (this.rnd() < c.density * (pos % 2 === 0 ? 1 : 0.45)) {
        const deg = Math.floor(this.rnd() * 7);
        const oct = deg >= 5 ? 12 : 0;
        const note = c.root + 12 + scale[deg % 5]! + oct;
        this.a.pluck(hz(note), { vol: 0.12, dur: 1.2, bus: 'music', at: t, bright: c.bright });
      }
      // drums
      if (c.drums > 0) {
        if (pos === 0 || pos === 8 || (pos === 11 && c.drums > 0.7)) this.a.drum(62, { vol: 0.34 * c.drums, at: t, bus: 'music' });
        if (pos === 4 || pos === 12) this.a.noise(0.12, { vol: 0.08 * c.drums, freq: 2500, q: 0.8, at: t, bus: 'music' });
        if (c.drums > 0.8 && pos % 2 === 1) this.a.noise(0.04, { vol: 0.03, freq: 7000, type: 'highpass', at: t, bus: 'music' });
      }
      // occasional chime
      if (pos === 0 && bar % 4 === 3) this.a.chime(hz(c.root + 24), { vol: 0.05, dur: 3, bus: 'music', at: t });
      this.next += beat;
      this.step++;
    }
  }
}

// ───────────── SFX catalogue ─────────────

export type Sfx =
  | 'click' | 'hover' | 'deny' | 'draw' | 'shuffle' | 'discard' | 'play' | 'playUnit' | 'playResponse' | 'playEquip' | 'playDelay' | 'playField'
  | 'legendary' | 'hit' | 'hitHeavy' | 'block' | 'wardBreak' | 'death' | 'sacrifice' | 'window' | 'judgeFlip' | 'judgeSun' | 'judgeThunder'
  | 'judgeMoon' | 'judgeMountain' | 'rejudge' | 'burn' | 'poison' | 'freeze' | 'heal' | 'buff' | 'debuff' | 'turnPlayer' | 'turnEnemy'
  | 'victory' | 'defeat' | 'gold' | 'relic' | 'step' | 'endTurn' | 'ember' | 'armor' | 'summon' | 'bossIntro' | 'phase' | 'cardHover' | 'stun' | 'declare';

let lastPlayed: Partial<Record<Sfx, number>> = {};

export function sfx(name: Sfx, intensity = 1) {
  const a = audio;
  if (!a.ctx) return;
  const now = performance.now();
  if ((lastPlayed[name] ?? 0) > now - 35) return;
  lastPlayed[name] = now;
  if (a.playSample(name, intensity)) return;
  const v = Math.min(1.5, intensity);
  switch (name) {
    case 'click': a.tone(880, 0.06, { type: 'triangle', vol: 0.12 }); a.tone(1320, 0.05, { vol: 0.05, at: a.now + 0.01 }); break;
    case 'hover': a.tone(1760, 0.03, { type: 'sine', vol: 0.03 }); break;
    case 'cardHover': a.noise(0.06, { vol: 0.04, freq: 3000, q: 0.7 }); break;
    case 'deny': a.tone(180, 0.14, { type: 'square', vol: 0.08, filter: 900 }); a.tone(150, 0.16, { type: 'square', vol: 0.06, filter: 800, at: a.now + 0.07 }); break;
    case 'draw': a.noise(0.12, { vol: 0.09, freq: 2200, freqEnd: 4000, q: 0.9 }); break;
    case 'shuffle': for (let i = 0; i < 6; i++) a.noise(0.05, { vol: 0.06, freq: 2500 + i * 200, q: 1, at: a.now + i * 0.04 }); break;
    case 'discard': a.noise(0.18, { vol: 0.07, freq: 1800, freqEnd: 900, q: 0.8 }); break;
    case 'play': a.noise(0.2, { vol: 0.12, freq: 900, freqEnd: 2600, q: 0.7 }); a.pluck(587, { vol: 0.08, dur: 0.6 }); break;
    case 'playUnit': a.drum(70, { vol: 0.45 }); a.noise(0.35, { vol: 0.12, type: 'lowpass', freq: 400 }); break;
    case 'playResponse': a.tone(1200, 0.25, { type: 'triangle', vol: 0.12, glide: 600 }); a.chime(880, { vol: 0.08, dur: 1 }); break;
    case 'playEquip': a.tone(2400, 0.4, { type: 'sine', vol: 0.08, wet: 0.3 }); a.noise(0.08, { vol: 0.12, freq: 5000, q: 2 }); break;
    case 'playDelay': a.chime(660, { vol: 0.1, dur: 1.6 }); break;
    case 'playField': a.drum(55, { vol: 0.4, dur: 0.6 }); a.chime(330, { vol: 0.08, dur: 2 }); break;
    case 'legendary': a.drum(45, { vol: 0.6, dur: 0.9 }); a.chime(220, { vol: 0.2, dur: 4 }); a.chime(330, { vol: 0.14, dur: 4, at: a.now + 0.15 }); a.noise(1.2, { vol: 0.1, freq: 300, freqEnd: 3000, q: 0.5, wet: 0.5 }); break;
    case 'hit': a.noise(0.12, { vol: 0.25 * v, freq: 1400, q: 0.7 }); a.tone(160, 0.12, { type: 'sine', vol: 0.25 * v, glide: 60 }); break;
    case 'hitHeavy': a.noise(0.25, { vol: 0.35 * v, freq: 800, q: 0.5 }); a.tone(110, 0.3, { type: 'sine', vol: 0.4 * v, glide: 40 }); a.drum(50, { vol: 0.3 * v }); break;
    case 'block': a.tone(620, 0.16, { type: 'square', vol: 0.06, filter: 1800 }); a.noise(0.08, { vol: 0.15, freq: 3200, q: 3 }); break;
    case 'armor': a.tone(440, 0.2, { type: 'triangle', vol: 0.1 }); a.tone(660, 0.25, { type: 'sine', vol: 0.06, at: a.now + 0.05 }); break;
    case 'wardBreak': for (let i = 0; i < 5; i++) a.tone(2000 + i * 400, 0.3, { vol: 0.05, at: a.now + i * 0.03, wet: 0.4 }); a.noise(0.3, { vol: 0.12, freq: 6000, type: 'highpass' }); break;
    case 'death': a.noise(0.5, { vol: 0.15, freq: 600, freqEnd: 120, q: 0.6, wet: 0.3 }); a.tone(220, 0.5, { vol: 0.1, glide: 80, type: 'triangle' }); break;
    case 'sacrifice': a.noise(0.5, { vol: 0.14, freq: 500, freqEnd: 3000, q: 1.2, wet: 0.4 }); a.chime(520, { vol: 0.12, dur: 1.5, at: a.now + 0.3 }); break;
    case 'window': a.chime(392, { vol: 0.16, dur: 2 }); a.tone(196, 0.8, { type: 'sine', vol: 0.12 }); break;
    case 'declare': a.drum(80, { vol: 0.25 }); break;
    case 'judgeFlip': a.noise(0.18, { vol: 0.12, freq: 2800, freqEnd: 1200, q: 1 }); break;
    case 'judgeSun': a.chime(523, { vol: 0.2, dur: 2.5 }); a.chime(784, { vol: 0.12, dur: 2.5, at: a.now + 0.08 }); break;
    case 'judgeThunder': a.noise(0.7, { vol: 0.25, freq: 200, type: 'lowpass', wet: 0.4 }); a.tone(80, 0.6, { vol: 0.25, glide: 40 }); a.chime(466, { vol: 0.1, dur: 1.5 }); break;
    case 'judgeMoon': a.chime(622, { vol: 0.16, dur: 3 }); a.tone(311, 1.2, { vol: 0.06, attack: 0.2, wet: 0.6 }); break;
    case 'judgeMountain': a.drum(60, { vol: 0.35, dur: 0.6 }); a.chime(294, { vol: 0.14, dur: 2.2 }); break;
    case 'rejudge': a.noise(0.3, { vol: 0.12, freq: 1000, freqEnd: 4000, q: 1.5 }); a.chime(698, { vol: 0.14, dur: 1.5, at: a.now + 0.2 }); break;
    case 'burn': a.noise(0.4, { vol: 0.14, freq: 700, freqEnd: 1600, q: 0.6 }); break;
    case 'poison': a.tone(300, 0.3, { type: 'sine', vol: 0.08, glide: 180 }); a.noise(0.2, { vol: 0.06, freq: 1200, q: 4 }); break;
    case 'freeze': for (let i = 0; i < 4; i++) a.tone(3000 + i * 500, 0.25, { vol: 0.04, at: a.now + i * 0.04, wet: 0.5 }); break;
    case 'stun': a.tone(1500, 0.4, { type: 'sine', vol: 0.06, glide: 800 }); a.tone(1800, 0.4, { type: 'sine', vol: 0.05, glide: 1000, at: a.now + 0.1 }); break;
    case 'heal': a.chime(784, { vol: 0.08, dur: 1.2 }); a.tone(1046, 0.5, { vol: 0.05, attack: 0.1, wet: 0.5 }); break;
    case 'buff': a.tone(523, 0.18, { type: 'triangle', vol: 0.08 }); a.tone(784, 0.25, { type: 'triangle', vol: 0.08, at: a.now + 0.08 }); break;
    case 'debuff': a.tone(392, 0.2, { type: 'triangle', vol: 0.08 }); a.tone(262, 0.3, { type: 'triangle', vol: 0.08, at: a.now + 0.08 }); break;
    case 'summon': a.chime(440, { vol: 0.08, dur: 1 }); a.noise(0.4, { vol: 0.08, freq: 400, freqEnd: 2000, q: 0.8 }); break;
    case 'turnPlayer': a.drum(70, { vol: 0.35 }); a.pluck(392, { vol: 0.14, dur: 1.2, at: a.now + 0.1 }); a.pluck(587, { vol: 0.12, dur: 1.4, at: a.now + 0.22 }); break;
    case 'turnEnemy': a.drum(55, { vol: 0.4 }); a.drum(55, { vol: 0.3, at: a.now + 0.25 }); break;
    case 'endTurn': a.tone(330, 0.12, { type: 'triangle', vol: 0.1 }); break;
    case 'ember': a.noise(0.3, { vol: 0.08, freq: 1500, q: 2 }); break;
    case 'gold': for (let i = 0; i < 3; i++) a.tone(2000 + i * 300, 0.12, { vol: 0.06, at: a.now + i * 0.05 }); break;
    case 'relic': a.chime(659, { vol: 0.16, dur: 2 }); a.chime(988, { vol: 0.1, dur: 2, at: a.now + 0.12 }); break;
    case 'step': a.noise(0.1, { vol: 0.06, freq: 700, q: 0.8 }); break;
    case 'bossIntro': a.drum(40, { vol: 0.7, dur: 1.2 }); a.noise(1.8, { vol: 0.12, freq: 150, type: 'lowpass', wet: 0.6 }); a.chime(147, { vol: 0.2, dur: 5, at: a.now + 0.4 }); break;
    case 'phase': a.drum(45, { vol: 0.6, dur: 1 }); a.noise(1, { vol: 0.15, freq: 200, freqEnd: 2000, q: 0.5, wet: 0.5 }); break;
    case 'victory': [523, 659, 784, 1046].forEach((f, i) => a.pluck(f, { vol: 0.16, dur: 1.8, at: a.now + i * 0.14 })); a.chime(1046, { vol: 0.12, dur: 3, at: a.now + 0.6 }); break;
    case 'defeat': [392, 349, 311, 262].forEach((f, i) => a.pluck(f, { vol: 0.14, dur: 2, at: a.now + i * 0.3, bright: 0.5 })); break;
  }
}

export function resetSfxThrottle() { lastPlayed = {}; }
