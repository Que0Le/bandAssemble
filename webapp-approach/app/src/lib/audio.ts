// Master-only audio engine. Owns the authoritative playhead via
// AudioContext.currentTime, plus a lookahead metronome scheduler and optional
// playback of a loaded recording. See ../../01-tech-stack-feasibility.md (audio).

export class MasterAudio {
  rate = 1;
  metronome = true;

  private ctx?: AudioContext;
  private playing = false;
  private anchorCtx = 0; // ctx.currentTime at anchor
  private anchorSec = 0; // playhead seconds at anchor
  private nextClickSec = 0;
  private buffer?: AudioBuffer;
  private src?: AudioBufferSourceNode;

  constructor(private bpm: number) {}
  private get beat() {
    return 60 / this.bpm;
  }

  ensure(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  playheadSec(): number {
    if (!this.playing || !this.ctx) return this.anchorSec;
    return this.anchorSec + (this.ctx.currentTime - this.anchorCtx) * this.rate;
  }

  private setAnchor(atSec: number): void {
    this.anchorSec = atSec;
    this.anchorCtx = this.ctx ? this.ctx.currentTime : 0;
    this.nextClickSec = Math.ceil(atSec / this.beat) * this.beat;
    this.restartBuffer();
  }

  start(atSec: number): void {
    this.ensure();
    this.playing = true;
    this.setAnchor(atSec);
  }

  /** Stop and return the playhead where we stopped. */
  stop(): number {
    const at = this.playheadSec();
    this.playing = false;
    this.anchorSec = at;
    if (this.src) {
      try {
        this.src.stop();
      } catch {}
      this.src = undefined;
    }
    return at;
  }

  seek(atSec: number): void {
    this.anchorSec = atSec;
    if (this.playing) this.setAnchor(atSec);
  }

  setRate(rate: number): void {
    const at = this.playheadSec();
    this.rate = rate;
    if (this.playing) this.setAnchor(at);
  }

  async loadFile(file: File): Promise<void> {
    this.ensure();
    this.buffer = await this.ctx!.decodeAudioData(await file.arrayBuffer());
    if (this.playing) this.setAnchor(this.playheadSec());
  }

  private restartBuffer(): void {
    if (this.src) {
      try {
        this.src.stop();
      } catch {}
      this.src = undefined;
    }
    if (!this.buffer || !this.playing || !this.ctx) return;
    this.src = this.ctx.createBufferSource();
    this.src.buffer = this.buffer;
    this.src.playbackRate.value = this.rate;
    this.src.connect(this.ctx.destination);
    const off = Math.max(0, Math.min(this.anchorSec, this.buffer.duration - 0.01));
    this.src.start(this.ctx.currentTime, off);
  }

  /** Call ~every 25ms while playing: schedules metronome clicks ahead on the audio thread. */
  tick(): void {
    if (!this.ctx || !this.playing || !this.metronome) return;
    const lookahead = 0.15;
    const head = this.playheadSec();
    while (this.nextClickSec < head + lookahead) {
      const ctxTime = this.anchorCtx + (this.nextClickSec - this.anchorSec) / this.rate;
      if (ctxTime >= this.ctx.currentTime) {
        this.click(ctxTime, this.nextClickSec % (this.beat * 4) < 1e-6);
      }
      this.nextClickSec += this.beat;
    }
  }

  private click(ctxTime: number, strong: boolean): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.frequency.value = strong ? 1500 : 900;
    g.gain.setValueAtTime(0.0001, ctxTime);
    g.gain.exponentialRampToValueAtTime(strong ? 0.5 : 0.25, ctxTime + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, ctxTime + 0.06);
    osc.connect(g).connect(this.ctx.destination);
    osc.start(ctxTime);
    osc.stop(ctxTime + 0.07);
  }
}
