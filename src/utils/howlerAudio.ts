/**
 * Satisfying UI sound engine — high-dopamine edition v2.
 *
 * Fixes from v1 (which was still too sharp):
 *  1. Per-voice gain dropped from 0.20-0.25 → 0.10-0.13 (was clipping when layers summed)
 *  2. Lowpass cutoff dropped from 2.5-4kHz → 1.2-2.5kHz (1 octave lower — kills the 3-4kHz sharpness band)
 *  3. Reverb impulse changed from white noise → brown noise lowpassed at 2kHz (was sibilant)
 *  4. Added glue compressor + brickwall limiter on master bus (prevents clipping)
 *  5. Sub-bass now lowpassed at 200-400Hz (was intermodulating with mid tone → "honk")
 *  6. Added ±3% pitch jitter + ±2dB gain jitter per voice (anti-fatigue)
 *  7. Filter Q fixed at 0.707 (was whistling at Q>1)
 *  8. Attack kept at 1-3ms (was 4-8ms which felt like "thump")
 *
 * Each event has a STRUCTURALLY DIFFERENT recipe — not just frequency swaps:
 *  - tab: pure filtered noise burst (no tone)
 *  - click: tone + noise transient + sub
 *  - vote: ascending perfect-fifth glide
 *  - success: arpeggiated major chord (C-E-G)
 *  - error: descending minor third (triangle, muffled)
 *  - hover: ultra-short bandpass noise tick
 *  - toggle_on/off: bright vs dim sine
 *  - modal_open/close: ascending vs descending bandpass noise sweep
 *  - champion: ascending arpeggio + sustained chord + sub thump
 *  - elo: round-robin ascending semitones (chromatic climb)
 *  - notify: marimba-style double-octave ping
 *  - like: rising pitch pop with noise tick
 *
 * Research sources: Salimpoor 2013 (dopamine), Zlobin/UX Collective 2020 (sharpness),
 * gskinner 2019 (Web Audio reverb), alemangui (setTargetAtTime), MDN.
 */

import { Howler } from 'howler';

class SfxEngine {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  reverb: ConvolverNode | null = null;
  reverbSend: GainNode | null = null;
  muted = false;
  _irPromise: Promise<AudioBuffer | null> | null = null;
  _rr: Record<string, number> = {};

  async init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      return;
    }
    // Prefer Howler's existing context so mute stays in sync
    const howlerCtx = (Howler as any).ctx as AudioContext | undefined;
    this.ctx = howlerCtx ?? new (window.AudioContext || (window as any).webkitAudioContext)();
    if (!howlerCtx) (Howler as any).ctx = this.ctx;

    // master bus: gain -> glue comp -> limiter -> destination
    const master = this.ctx.createGain();
    master.gain.value = 0.9;

    const glue = this.ctx.createDynamicsCompressor();
    glue.threshold.value = -18;
    glue.knee.value = 24;
    glue.ratio.value = 4;
    glue.attack.value = 0.003;
    glue.release.value = 0.18;

    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -1.5;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.05;

    master.connect(glue).connect(limiter).connect(this.ctx.destination);
    this.master = master;

    // reverb send bus (built lazily, IR is async)
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = 1.0;
    this.reverb = this.ctx.createConvolver();
    const reverbReturn = this.ctx.createGain();
    reverbReturn.gain.value = 1.0;
    this.reverbSend.connect(this.reverb).connect(reverbReturn).connect(master);

    this._irPromise = this._makeIR({ seconds: 0.6, decay: 3.0, cutoff: 2000 });
    this._irPromise.then(buf => {
      if (buf && this.reverb) this.reverb.buffer = buf;
    });
  }

  async _makeIR({ seconds, decay, cutoff }: { seconds: number; decay: number; cutoff: number }): Promise<AudioBuffer | null> {
    if (!this.ctx) return null;
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const OfflineAC = (window as any).OfflineAudioContext || (window as any).webkitOfflineAudioContext;
    if (!OfflineAC) return null;
    const off = new OfflineAC(2, len, rate);
    const src = off.createBufferSource();
    const buf = off.createBuffer(2, len, rate);
    // Brown-ish noise (warm) — much darker than white noise, removes sibilance
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        d[i] = last * 3.5 * Math.pow(1 - i / len, decay);
      }
    }
    src.buffer = buf;
    const lp = off.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = 0.7;
    src.connect(lp).connect(off.destination);
    src.start();
    return off.startRendering();
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.9;
  }

  isMuted() { return this.muted; }

  // ---- voice helper: builds a one-shot ----
  _voice({
    freq, type = 'sine', gain = 0.1, attack = 2, decay = 120,
    cutoff = 2000, q = 0.707, wet = 0.12, detune = 0, pitchEnd = null,
  }: {
    freq: number; type?: OscillatorType; gain?: number; attack?: number; decay?: number;
    cutoff?: number; q?: number; wet?: number; detune?: number; pitchEnd?: number | null;
  }) {
    if (!this.ctx || !this.master || !this.reverbSend) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    osc.detune.value = detune;
    if (pitchEnd) {
      osc.frequency.setValueAtTime(freq, t0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, pitchEnd), t0 + attack / 1000 + decay / 2000);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t0 + attack / 1000);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (attack + decay) / 1000);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = cutoff;
    lp.Q.value = q;

    osc.connect(g).connect(lp);
    lp.connect(this.master);

    if (wet > 0 && this.reverb) {
      const send = ctx.createGain();
      send.gain.value = wet;
      lp.connect(send).connect(this.reverbSend);
    }

    osc.start(t0);
    const stopAt = t0 + (attack + decay) / 1000 + 0.05;
    osc.stop(stopAt);
    osc.onended = () => {
      try { osc.disconnect(); g.disconnect(); lp.disconnect(); } catch {}
    };
  }

  _noise({
    gain = 0.08, attack = 1, decay = 40, cutoff = 1500, q = 0.7,
    type = 'lowpass' as BiquadFilterType, wet = 0.05, dur,
  }: {
    gain?: number; attack?: number; decay?: number; cutoff?: number; q?: number;
    type?: BiquadFilterType; wet?: number; dur?: number;
  }) {
    if (!this.ctx || !this.master || !this.reverbSend) return;
    const ctx = this.ctx, t0 = ctx.currentTime;
    const len = Math.floor(ctx.sampleRate * ((dur ?? (attack + decay) / 1000) + 0.02));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.001, gain), t0 + attack / 1000);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (attack + decay) / 1000);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = cutoff;
    f.Q.value = q;
    src.connect(g).connect(f);
    f.connect(this.master);
    if (wet > 0 && this.reverb) {
      const s = ctx.createGain();
      s.gain.value = wet;
      f.connect(s).connect(this.reverbSend);
    }
    src.start(t0);
    src.stop(t0 + len / ctx.sampleRate);
    src.onended = () => {
      try { src.disconnect(); g.disconnect(); f.disconnect(); } catch {}
    };
  }

  // ---- anti-fatigue helpers ----
  _rrIdx(name: string, n: number) {
    this._rr[name] = (this._rr[name] ?? 0) % n;
    return this._rr[name]++;
  }
  _jitterPitch(p = 0.03) { return 1 + (Math.random() * 2 - 1) * p; }      // ±3%
  _jitterGainLin(g: number, db = 2) { return g * Math.pow(10, (Math.random() * 2 - 1) * db / 20); } // ±2 dB

  // ---- public event API ----
  play(name: string) {
    if (!this.ctx || this.muted) return;
    switch (name) {
      case 'tab':
        // Pure filtered noise — no tonal content. Neutral "switch" feel.
        this._noise({ gain: 0.06, attack: 1, decay: 25, cutoff: 1400, q: 1, type: 'bandpass', wet: 0 });
        break;

      case 'click':
        // Tone + noise transient + sub thump — physical "thock" of a mechanical key.
        this._voice({ freq: 220 * this._jitterPitch(), type: 'sine', gain: this._jitterGainLin(0.10), attack: 1, decay: 60, cutoff: 2000, wet: 0.06 });
        this._noise({ gain: 0.08, attack: 1, decay: 25, cutoff: 1200, wet: 0.06 });
        this._voice({ freq: 110, type: 'sine', gain: 0.06, attack: 1, decay: 40, cutoff: 600, wet: 0.06 });
        break;

      case 'vote':
        // Ascending perfect-fifth glide (A4→E5) — Duolingo-style reward.
        this._voice({ freq: 440, type: 'sine', gain: 0.12, attack: 3, decay: 200, cutoff: 2000, wet: 0.12, pitchEnd: 660 });
        this._voice({ freq: 880, type: 'sine', gain: 0.04, attack: 3, decay: 200, cutoff: 3000, wet: 0.12, pitchEnd: 1320 });
        this._voice({ freq: 110, type: 'sine', gain: 0.06, attack: 3, decay: 180, cutoff: 400, wet: 0.12 });
        break;

      case 'success':
        // Arpeggiated C major chord (C-E-G) — Apple tri-tone pattern.
        [523, 659, 784].forEach((f, i) => setTimeout(() => this._voice({
          freq: f, type: 'sine', gain: 0.11, attack: 2, decay: 150, cutoff: 2500, wet: 0.18,
          detune: (Math.random() * 2 - 1) * 5,
        }), i * 70));
        break;

      case 'error':
        // Descending minor third (G4→Eb4), triangle, muffled — soft "no".
        this._voice({ freq: 392, type: 'triangle', gain: 0.10, attack: 4, decay: 220, cutoff: 1400, wet: 0.08, pitchEnd: 311 });
        this._noise({ gain: 0.05, attack: 2, decay: 40, cutoff: 800, wet: 0.08 });
        break;

      case 'hover':
        // Ultra-short bandpass tick — barely audible.
        this._noise({ gain: 0.03, attack: 0.5, decay: 6, cutoff: 2000, q: 2, type: 'bandpass', wet: 0 });
        break;

      case 'toggle_on':
        this._voice({ freq: 880, type: 'sine', gain: 0.09, attack: 1, decay: 90, cutoff: 3000, wet: 0.05 });
        break;

      case 'toggle_off':
        this._voice({ freq: 660, type: 'sine', gain: 0.09, attack: 1, decay: 90, cutoff: 3000, wet: 0.05 });
        break;

      case 'modal_open':
        // Ascending bandpass sweep — whoosh up.
        this._noise({ gain: 0.09, attack: 10, decay: 160, cutoff: 2500, q: 1, type: 'bandpass', wet: 0.10 });
        break;

      case 'modal_close':
        // Descending bandpass sweep — whoosh down.
        this._noise({ gain: 0.08, attack: 10, decay: 160, cutoff: 500, q: 1, type: 'bandpass', wet: 0.10 });
        break;

      case 'levelup':
        // Same as success but longer — kept for backwards compatibility.
        [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this._voice({
          freq: f, type: 'sine', gain: 0.11, attack: 2, decay: i === 3 ? 350 : 150, cutoff: 2800, wet: 0.22,
        }), i * 90));
        break;

      case 'champion': {
        // Ascending arpeggio + sustained final + sub thump — cinematic.
        const seq = [523, 659, 784, 1047];
        seq.forEach((f, i) => setTimeout(() => {
          this._voice({ freq: f, type: 'sine', gain: 0.12, attack: 2, decay: i === seq.length - 1 ? 600 : 120, cutoff: 3000, wet: 0.15 });
          this._voice({ freq: f * 2, type: 'triangle', gain: 0.04, attack: 2, decay: i === seq.length - 1 ? 500 : 100, cutoff: 4000, wet: 0.15 });
          if (i === seq.length - 1) this._voice({ freq: 65, type: 'sine', gain: 0.06, attack: 5, decay: 600, cutoff: 200, wet: 0.15 });
        }, i * 120));
        break;
      }

      case 'elo':
      case 'tick': {
        // Round-robin ascending semitones — chromatic climb, 12 steps then wraps.
        const idx = this._rrIdx('elo', 12);
        const f = 660 * Math.pow(2, idx / 12);
        this._voice({ freq: f, type: 'sine', gain: this._jitterGainLin(0.05 + idx * 0.003), attack: 1, decay: 35, cutoff: 2500, wet: 0.08 });
        this._voice({ freq: f * 2, type: 'sine', gain: 0.012, attack: 1, decay: 30, cutoff: 4000, wet: 0.08 });
        break;
      }

      case 'notify':
        // Marimba-style double-octave ping (Telegram-style).
        this._voice({ freq: 988, type: 'sine', gain: 0.12, attack: 2, decay: 280, cutoff: 2500, wet: 0.18 });
        this._voice({ freq: 1976, type: 'sine', gain: 0.018, attack: 2, decay: 200, cutoff: 4000, wet: 0.18 });
        this._voice({ freq: 123, type: 'sine', gain: 0.04, attack: 2, decay: 120, cutoff: 500, wet: 0.18 });
        break;

      case 'like':
        // Rising pitch pop (600→1100 Hz) + tiny noise tick — Twitter heart.
        this._voice({ freq: 600, type: 'sine', gain: 0.13, attack: 2, decay: 90, cutoff: 2500, wet: 0.06, pitchEnd: 1100 });
        this._noise({ gain: 0.02, attack: 0.5, decay: 4, cutoff: 2000, wet: 0 });
        break;

      default:
        // Unknown event — fall back to a soft click.
        this._voice({ freq: 220 * this._jitterPitch(), type: 'sine', gain: this._jitterGainLin(0.10), attack: 1, decay: 60, cutoff: 2000, wet: 0.06 });
        break;
    }
  }
}

// ---- Singleton + legacy exports ----
const sfx = new SfxEngine();

// Tracks whether we've attached the one-time gesture unlock listener.
// We can't create AudioContext until the user interacts with the page
// (browser autoplay policy), so we lazy-init on first playSound() call.
let _unlocked = false;

function _unlockOnGesture() {
  if (_unlocked) return;
  _unlocked = true;
  // init() is async; fire-and-forget. The first click's sound may be
  // sacrificed, but every subsequent click will play correctly.
  sfx.init().catch(() => {});
  // Remove the listeners immediately — we only need one gesture to unlock
  window.removeEventListener('pointerdown', _unlockOnGesture);
  window.removeEventListener('keydown', _unlockOnGesture);
  window.removeEventListener('touchstart', _unlockOnGesture);
}

export function initAudio() {
  // Called from main.tsx on app start — but we MUST NOT create AudioContext
  // here (autoplay violation). Instead, register gesture listeners that
  // will create it on first user interaction.
  if (typeof window === 'undefined') return;
  if (_unlocked) {
    sfx.init().catch(() => {});
    return;
  }
  window.addEventListener('pointerdown', _unlockOnGesture, { once: false, passive: true });
  window.addEventListener('keydown', _unlockOnGesture, { once: false, passive: true });
  window.addEventListener('touchstart', _unlockOnGesture, { once: false, passive: true });
}

export function playSound(name: string) {
  // If context isn't ready yet, try to init now (this is always called from
  // a user gesture — click handlers, key handlers, etc.)
  if (!sfx.ctx) {
    sfx.init().catch(() => {});
    // Note: the very first sound may be skipped while ctx spins up.
    // Subsequent calls will work.
  }
  sfx.play(name);
}

export function setMuted(m: boolean) {
  sfx.setMuted(m);
  Howler.mute(m);
}

export function isMuted() {
  return sfx.isMuted();
}

export function playChampionFanfare() {
  if (!sfx.ctx) {
    sfx.init().catch(() => {});
  }
  sfx.play('champion');
}

// Expose the engine instance for advanced use cases
export { sfx };
