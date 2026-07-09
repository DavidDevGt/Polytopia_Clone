/**
 * Tiny synthesized sound effects with the Web Audio API — no assets, a few
 * oscillators with fast envelopes. Everything routes through a master gain
 * so mute is one flag.
 */

export type SfxName =
  | 'select'
  | 'move'
  | 'attack'
  | 'kill'
  | 'capture'
  | 'train'
  | 'harvest'
  | 'turn'
  | 'levelup'
  | 'victory'
  | 'error';

export class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  muted = false;

  /** Must be called from a user gesture (browser autoplay policy). */
  private ensureContext(): AudioContext | null {
    if (!this.ctx) {
      const Ctx = window.AudioContext;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.16;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    return this.muted;
  }

  play(name: SfxName): void {
    if (this.muted) {
      return;
    }
    const ctx = this.ensureContext();
    if (!ctx || !this.master) {
      return;
    }
    const t = ctx.currentTime;
    switch (name) {
      case 'select':
        this.blip(t, 660, 0.05, 'triangle');
        break;
      case 'move':
        this.sweep(t, 300, 480, 0.09, 'sine');
        break;
      case 'attack':
        this.sweep(t, 220, 90, 0.12, 'square', 0.12);
        break;
      case 'kill':
        this.sweep(t, 180, 40, 0.28, 'sawtooth', 0.16);
        break;
      case 'capture':
        this.arpeggio(t, [392, 494, 587], 0.08);
        break;
      case 'train':
        this.arpeggio(t, [330, 415], 0.07);
        break;
      case 'harvest':
        this.blip(t, 880, 0.06, 'sine');
        this.blip(t + 0.07, 1175, 0.06, 'sine');
        break;
      case 'turn':
        this.blip(t, 523, 0.09, 'triangle');
        break;
      case 'levelup':
        this.arpeggio(t, [523, 659, 784, 1047], 0.07);
        break;
      case 'victory':
        this.arpeggio(t, [523, 659, 784, 1047, 1319], 0.12);
        break;
      case 'error':
        this.blip(t, 140, 0.12, 'square', 0.08);
        break;
    }
  }

  private blip(at: number, freq: number, duration: number, type: OscillatorType, gain = 0.2): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + duration);
    osc.connect(env).connect(this.master!);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private sweep(
    at: number,
    from: number,
    to: number,
    duration: number,
    type: OscillatorType,
    gain = 0.18,
  ): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), at + duration);
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.001, at + duration);
    osc.connect(env).connect(this.master!);
    osc.start(at);
    osc.stop(at + duration + 0.02);
  }

  private arpeggio(at: number, freqs: readonly number[], step: number): void {
    freqs.forEach((freq, i) => {
      this.blip(at + i * step, freq, step * 1.6, 'triangle', 0.16);
    });
  }
}
