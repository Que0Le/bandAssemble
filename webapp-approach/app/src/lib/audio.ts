// Master-only clock + metronome. When a media element (the project's audio/video)
// is attached, THAT element is the authoritative playhead and the sound/picture
// source — so the Maestro sees the video and hears the real track, and the band
// follows the element's currentTime. With no media attached (pure practice), we
// fall back to a synthetic AudioContext clock and a lookahead metronome.
// See ../../01-tech-stack-feasibility.md (audio).

export class MasterAudio {
  rate = 1;
  metronome = true;

  private ctx?: AudioContext;
  private playing = false;
  private anchorCtx = 0; // ctx.currentTime at anchor (synthetic clock)
  private anchorSec = 0; // playhead seconds at anchor
  private nextClickSec = 0;
  private el?: HTMLMediaElement; // the real recording, when present (clock + sound)

  constructor(private bpm: number) {}
  private get beat() {
    return 60 / this.bpm;
  }

  ensure(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Attach (or detach with undefined) the project's media element. While attached
   *  it is the clock and the sound — the decoded-buffer path is not used. */
  attach(el?: HTMLMediaElement): void {
    this.el = el;
    if (el) el.playbackRate = this.rate;
  }
  get hasMedia(): boolean {
    return !!this.el;
  }

  playheadSec(): number {
    if (this.el) return this.el.currentTime;
    if (!this.playing || !this.ctx) return this.anchorSec;
    return this.anchorSec + (this.ctx.currentTime - this.anchorCtx) * this.rate;
  }

  private setAnchor(atSec: number): void {
    this.anchorSec = atSec;
    this.anchorCtx = this.ctx ? this.ctx.currentTime : 0;
    this.nextClickSec = Math.ceil(atSec / this.beat) * this.beat;
  }

  start(atSec: number): void {
    this.ensure();
    this.playing = true;
    if (this.el) {
      if (Math.abs(this.el.currentTime - atSec) > 0.05) this.el.currentTime = atSec;
      void this.el.play().catch(() => {}); // play() can reject if interrupted/blocked
    }
    this.setAnchor(atSec);
  }

  /** Stop and return the playhead where we stopped. */
  stop(): number {
    const at = this.playheadSec();
    this.playing = false;
    this.anchorSec = at;
    if (this.el) this.el.pause();
    return at;
  }

  seek(atSec: number): void {
    this.anchorSec = atSec;
    if (this.el) this.el.currentTime = atSec;
    if (this.playing) this.setAnchor(atSec);
  }

  setRate(rate: number): void {
    const at = this.playheadSec();
    this.rate = rate;
    if (this.el) this.el.playbackRate = rate;
    if (this.playing) this.setAnchor(at);
  }

  /** Call ~every 25ms while playing: schedules metronome clicks ahead on the audio
   *  thread. Driven off the synthetic anchor; typically off once a real track is
   *  attached (the recording keeps time), so it mainly serves practice mode. */
  tick(): void {
    if (!this.ctx || !this.playing || !this.metronome || this.el) return;
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
