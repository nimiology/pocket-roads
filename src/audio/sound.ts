/**
 * Procedural audio: generative ambient music plus small synthesized effects. No asset files.
 * The AudioContext is created on the first user gesture (browsers block audio before that).
 */

const STORAGE_KEY = 'pocket-roads.muted';
/** Major pentatonic degrees in semitones; everything melodic stays in this scale so it never clashes. */
const PENTA = [0, 2, 4, 7, 9];
const ROOT = 57; // A3 (MIDI)
/** Chord roots in scale steps for a slow I – vi – IV – V loop, as semitone offsets from ROOT. */
const PROGRESSION = [0, 9, 5, 7];
const BEAT = 60 / 66;

const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);

export class Sound {
  ctx?: AudioContext;
  private master?: GainNode;
  private music?: GainNode;
  private sfx?: GainNode;
  private wet?: GainNode;
  private nextBeat = 0;
  private beat = 0;
  private lastAt = new Map<string, number>();
  muted = false;

  constructor() {
    try { this.muted = localStorage.getItem(STORAGE_KEY) === '1'; } catch { /* storage blocked */ }
    const unlock = () => {
      this.start();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
  }

  private start() {
    if (this.ctx) return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    // Gentle bus compression keeps stacked chimes from clipping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.music.gain.value = 0.32;
    this.sfx = ctx.createGain();
    this.sfx.gain.value = 0.55;
    // Shared reverb send: a convolver on a synthetic decaying-noise impulse.
    const verb = ctx.createConvolver();
    verb.buffer = impulse(ctx, 2.8);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.35;
    this.wet.connect(verb).connect(this.master);
    this.music.connect(this.master);
    this.music.connect(this.wet);
    this.sfx.connect(this.master);
    this.sfx.connect(this.wet);
    this.nextBeat = ctx.currentTime + 0.2;
    // Look-ahead scheduler: queue notes slightly ahead of time so timing is sample-accurate.
    setInterval(() => this.schedule(), 100);
  }

  setMuted(m: boolean): void {
    this.muted = m;
    try { localStorage.setItem(STORAGE_KEY, m ? '1' : '0'); } catch { /* ignore */ }
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** Music swells down while menus or game over are up. */
  setMusicLevel(level: number): void {
    if (this.ctx && this.music) this.music.gain.setTargetAtTime(0.32 * level, this.ctx.currentTime, 0.6);
  }

  // ---- music ----------------------------------------------------------------

  private schedule() {
    const ctx = this.ctx!;
    while (this.nextBeat < ctx.currentTime + 0.4) {
      this.playBeat(this.beat, this.nextBeat);
      this.nextBeat += BEAT;
      this.beat++;
    }
  }

  private playBeat(beat: number, t: number) {
    const bar = Math.floor(beat / 4), inBar = beat % 4;
    const chord = PROGRESSION[Math.floor(bar / 2) % PROGRESSION.length];
    // Pad: a soft triad at the start of every two bars.
    if (inBar === 0 && bar % 2 === 0) {
      for (const iv of [0, 4, 7, 12]) this.voice(midiHz(ROOT - 12 + chord + iv), t, BEAT * 8, 'sine', 0.05, this.music!, 1.6, 2.5);
    }
    // Bass on the downbeat.
    if (inBar === 0) this.voice(midiHz(ROOT - 24 + chord), t, BEAT * 3, 'triangle', 0.08, this.music!, 0.05, 1.2);
    // Sparse melody: a few pentatonic plucks, more likely on strong beats.
    if (Math.random() < (inBar % 2 === 0 ? 0.45 : 0.22)) {
      const deg = PENTA[Math.floor(Math.random() * PENTA.length)];
      const oct = Math.random() < 0.3 ? 24 : 12;
      const offset = Math.random() < 0.25 ? BEAT / 2 : 0;
      this.pluck(midiHz(ROOT + oct + deg), t + offset, 0.06, this.music!);
    }
  }

  // ---- building blocks --------------------------------------------------------

  private voice(freq: number, t: number, dur: number, type: OscillatorType, gain: number, out: AudioNode, attack = 0.01, release = 0.2) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0, t + Math.max(attack, dur - release), release / 3);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + dur + release);
  }

  /** Marimba-ish pluck: sine plus a quiet octave partial, fast decay. */
  private pluck(freq: number, t: number, gain: number, out: AudioNode) {
    this.voice(freq, t, 0.5, 'sine', gain, out, 0.004, 0.45);
    this.voice(freq * 4, t, 0.12, 'sine', gain * 0.18, out, 0.002, 0.1);
  }

  private ready(key: string, gap: number): boolean {
    if (!this.ctx || this.muted) return false;
    const now = this.ctx.currentTime;
    if (now - (this.lastAt.get(key) ?? -Infinity) < gap) return false;
    this.lastAt.set(key, now);
    return true;
  }

  // ---- effects ----------------------------------------------------------------

  place(): void {
    if (!this.ready('place', 0.04)) return;
    const t = this.ctx!.currentTime;
    this.voice(900 + Math.random() * 300, t, 0.04, 'triangle', 0.12, this.sfx!, 0.002, 0.04);
  }

  erase(): void {
    if (!this.ready('erase', 0.05)) return;
    const t = this.ctx!.currentTime;
    this.voice(320 + Math.random() * 60, t, 0.06, 'triangle', 0.12, this.sfx!, 0.002, 0.06);
  }

  /** A delivery chime, pitched by the building colour so each colour has its own note. */
  deliver(color: number): void {
    if (!this.ready(`deliver${color}`, 0.08)) return;
    const t = this.ctx!.currentTime;
    const deg = PENTA[color % PENTA.length] + 12 * Math.floor(color / PENTA.length);
    this.pluck(midiHz(ROOT + 24 + deg), t, 0.14, this.sfx!);
  }

  spawn(): void {
    if (!this.ready('spawn', 0.2)) return;
    const t = this.ctx!.currentTime;
    this.pluck(midiHz(ROOT + 12), t, 0.06, this.sfx!);
    this.pluck(midiHz(ROOT + 19), t + 0.07, 0.05, this.sfx!);
  }

  /** A short car horn; rate-limited so jams honk now and then rather than constantly. */
  horn(): void {
    if (!this.ready('horn', 1.6)) return;
    const ctx = this.ctx!, t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.value = 0.5;
    lp.connect(g).connect(this.sfx!);
    const base = 330 + Math.random() * 120;
    const dur = Math.random() < 0.3 ? 0.32 : 0.14;
    for (const f of [base, base * 1.26]) this.voice(f, t, dur, 'square', 0.05, lp, 0.01, 0.05);
  }

  /** Overflow warning tick; called often, it spaces itself out by `urgency` (0..1). */
  warn(urgency: number): void {
    if (!this.ready('warn', 1.3 - urgency * 0.9)) return;
    const t = this.ctx!.currentTime;
    this.voice(midiHz(ROOT + 31), t, 0.08, 'sine', 0.08 + urgency * 0.08, this.sfx!, 0.003, 0.08);
  }

  week(): void {
    if (!this.ready('week', 1)) return;
    const t = this.ctx!.currentTime;
    [0, 4, 7, 12].forEach((iv, i) => this.pluck(midiHz(ROOT + 12 + iv), t + i * 0.09, 0.11, this.sfx!));
  }

  gameOver(): void {
    if (!this.ready('over', 2)) return;
    const t = this.ctx!.currentTime;
    [12, 7, 4, 0].forEach((iv, i) => this.voice(midiHz(ROOT + iv), t + i * 0.22, 0.8, 'triangle', 0.1, this.sfx!, 0.01, 0.7));
  }

  click(): void {
    if (!this.ready('click', 0.03)) return;
    this.voice(1500, this.ctx!.currentTime, 0.03, 'sine', 0.08, this.sfx!, 0.001, 0.03);
  }
}

function impulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  }
  return buf;
}
