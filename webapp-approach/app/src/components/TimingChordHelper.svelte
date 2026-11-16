<script lang="ts">
  // Collapsible "Timing and chord helper": paste chords (Ultimate Guitar /
  // ChordPro) + an LRC, auto-align them into a timed chart, preview it, and push
  // it into the Editor's Sheet with "Use as sheet" (which keeps every timestamp).
  import { buildImport, toChordPro, toLrc } from '../lib/import';
  import { untrack } from 'svelte';
  import { copyText } from '../lib/clipboard';

  // Editor passes: a sink for the generated chart JSON + the raw paste (so the
  // project can remember it), and optional `initial` to repopulate on reopen.
  interface Source {
    chords: string;
    lrc: string;
    offset: number;
  }
  let { onUse, initial }: { onUse: (chartJson: string, source: Source) => void; initial?: Source } = $props();

  // Seed once from the saved paste (a one-time prefill, not a live binding).
  let chordsText = $state(untrack(() => initial?.chords ?? ''));
  let lrcText = $state(untrack(() => initial?.lrc ?? ''));
  let offset = $state(untrack(() => initial?.offset ?? 0));
  // Open state is local (bind:open), seeded once — NOT a controlled attribute, so
  // a re-render (e.g. moving the offset slider) can't snap the panel shut.
  let open = $state(!!untrack(() => initial?.chords));
  let exKind = $state<'cho' | 'lrc' | 'json'>('json');
  let flash = $state('');

  const mmss = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`;

  const result = $derived(buildImport(chordsText, lrcText, offset));
  const aligned = $derived(result.aligned);
  const objs = $derived(result.objects);
  const metaOut = $derived(result.meta);
  const chartJson = $derived(result.chart ? JSON.stringify(result.chart, null, 2) : '');

  const exText = $derived(
    !aligned ? '' : exKind === 'cho' ? toChordPro(objs, metaOut) : exKind === 'lrc' ? toLrc(objs, metaOut) : chartJson,
  );

  // Timeline rows (labels + lines in time order) with chord-over-word segments.
  interface Seg {
    ch: string;
    tx: string;
  }
  function segsFor(lyrics: string, chords: { chord: string; offset: number }[]): Seg[] {
    if (!chords.length) return [{ ch: '', tx: lyrics }];
    const cs = [...chords].sort((a, b) => a.offset - b.offset);
    const segs: Seg[] = [];
    if (cs[0].offset > 0) segs.push({ ch: '', tx: lyrics.slice(0, cs[0].offset) });
    for (let i = 0; i < cs.length; i++) {
      const start = Math.min(cs[i].offset, lyrics.length);
      const end = i + 1 < cs.length ? Math.min(cs[i + 1].offset, lyrics.length) : lyrics.length;
      segs.push({ ch: cs[i].chord, tx: lyrics.slice(start, end) || ' ' });
    }
    return segs;
  }
  type Row =
    | { kind: 'label'; time: number; text: string }
    | { kind: 'line'; time: number; matched: boolean; lyrics: string; segs: Seg[] };
  const rows = $derived.by<Row[]>(() => {
    if (!aligned) return [];
    const r: Row[] = aligned.lines.map((l) => ({
      kind: 'line' as const,
      time: l.time,
      matched: l.matched,
      lyrics: l.lyrics,
      segs: l.matched && l.source ? segsFor(l.source.lyrics, l.source.chords) : [],
    }));
    for (const lb of aligned.labels) r.push({ kind: 'label', time: lb.time, text: lb.label });
    return r.sort((a, b) => a.time - b.time || (a.kind === 'label' ? -1 : 1));
  });

  function note(m: string) {
    flash = m;
    setTimeout(() => (flash = ''), 1600);
  }
  async function copy() {
    note((await copyText(exText)) ? 'copied' : 'copy failed');
  }
  function download() {
    const ext = exKind === 'json' ? 'json' : exKind;
    const name = `${(aligned?.title || 'song').replace(/\s+/g, '-').toLowerCase()}.${ext}`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exText], { type: 'text/plain' }));
    a.download = name;
    a.click();
  }
  function useAsSheet() {
    if (!objs.length) return note('paste chords + an LRC first');
    onUse(chartJson, { chords: chordsText, lrc: lrcText, offset });
    note('sent to Sheet');
  }
</script>

<details class="helper" bind:open>
  <summary>🎚️ Timing and chord helper <span class="sub">— paste chords + an LRC → a timed chart</span></summary>
  <div class="body">
    <div class="ins">
      <div class="col">
        <label for="h-chords">Chords — paste from Ultimate Guitar or ChordPro</label>
        <textarea
          id="h-chords"
          bind:value={chordsText}
          spellcheck="false"
          placeholder={'[Verse 1]\nAm        C\nThere is a house...\n\nor ChordPro: [Am]There is a [C]house'}
        ></textarea>
      </div>
      <div class="col">
        <label for="h-lrc">Synced lyrics — paste an .lrc (from any lyrics-sync source)</label>
        <textarea
          id="h-lrc"
          bind:value={lrcText}
          spellcheck="false"
          placeholder={'[ti:Song]\n[00:12.00]There is a house\n[00:18.50]They call the Rising Sun'}
        ></textarea>
      </div>
    </div>

    <div class="ctl">
      <label class="off">Offset <input type="range" min="-5" max="5" step="0.1" bind:value={offset} /></label>
      <span class="offv">{offset.toFixed(1)}s</span>
      {#if aligned}
        <span class="cov">coverage <b>{Math.round(aligned.coverage * 100)}%</b></span>
        <span class="lbls">{aligned.labels.map((l) => `${l.label} @${mmss(l.time)}`).join('  ')}</span>
      {:else}
        <span class="hint">paste both boxes to align</span>
      {/if}
    </div>

    {#if aligned}
      <div class="timeline">
        {#each rows as r}
          {#if r.kind === 'label'}
            <div class="lbl">{r.text}</div>
          {:else}
            <div class="lrow" class:unmatched={!r.matched}>
              <span class="t">{mmss(r.time)}</span>
              {#if r.matched}
                <span class="body-cells">
                  {#each r.segs as s}<span class="seg"><span class="ch">{s.ch}</span><span class="tx">{s.tx}</span></span>{/each}
                </span>
              {:else}
                <span class="um">{r.lyrics || '(instrumental)'}</span>
              {/if}
            </div>
          {/if}
        {/each}
      </div>

      <div class="exports">
        <div class="tabs">
          <button class="tab" class:on={exKind === 'cho'} onclick={() => (exKind = 'cho')}>ChordPro</button>
          <button class="tab" class:on={exKind === 'lrc'} onclick={() => (exKind = 'lrc')}>LRC</button>
          <button class="tab" class:on={exKind === 'json'} onclick={() => (exKind = 'json')}>Chart JSON</button>
        </div>
        <pre class="exout">{exText}</pre>
        <div class="exbtns">
          <button class="btn" onclick={copy}>⧉ Copy</button>
          <button class="btn" onclick={download}>⤓ Download</button>
          <button class="btn use" onclick={useAsSheet} title="Load this timed chart into the Sheet box (keeps all timestamps)"
            >➜ Use as sheet</button
          >
          {#if flash}<span class="flash">{flash}</span>{/if}
        </div>
      </div>
    {/if}
  </div>
</details>

<style>
  .helper {
    border: 1px solid #2a3340;
    border-radius: 10px;
    background: #0e141c;
    margin-bottom: 16px;
  }
  summary {
    cursor: pointer;
    padding: 10px 14px;
    font-weight: 650;
    color: #e6edf3;
    user-select: none;
  }
  summary .sub {
    font-weight: 400;
    color: #8b93a3;
    font-size: 0.85rem;
  }
  .body {
    padding: 0 14px 14px;
  }
  .ins {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
  }
  @media (max-width: 820px) {
    .ins {
      grid-template-columns: 1fr;
    }
  }
  .col label {
    display: block;
    font-size: 0.78rem;
    color: #8b93a3;
    margin-bottom: 4px;
  }
  textarea {
    width: 100%;
    height: 150px;
    resize: vertical;
    font-family: var(--mono);
    font-size: 0.82rem;
    line-height: 1.45;
    color: #e8edf5;
    background: #0f1218;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 8px 10px;
  }
  .ctl {
    display: flex;
    align-items: center;
    gap: 14px;
    margin: 12px 0 6px;
    flex-wrap: wrap;
    font-size: 0.85rem;
    color: #8b93a3;
  }
  .off {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .offv {
    font-family: var(--mono);
    min-width: 42px;
  }
  .cov b {
    color: #7ee0a0;
  }
  .lbls {
    color: #7fd0ff;
    font-size: 0.8rem;
  }
  .timeline {
    max-height: 320px;
    overflow: auto;
    border: 1px solid #1c232e;
    border-radius: 8px;
    padding: 8px 10px;
    background: #0b0f16;
  }
  .lbl {
    color: #7fd0ff;
    font-weight: 700;
    font-size: 0.72rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    margin: 12px 0 4px;
  }
  .lrow {
    display: grid;
    grid-template-columns: 52px 1fr;
    gap: 10px;
    align-items: start;
    padding: 3px 4px;
  }
  .lrow .t {
    color: #6b7482;
    font: 0.7rem var(--mono);
    padding-top: 14px;
  }
  .body-cells {
    display: flex;
    flex-wrap: wrap;
  }
  .seg {
    display: inline-flex;
    flex-direction: column;
  }
  .seg .ch {
    color: #f0b429;
    font: 600 0.72rem var(--mono);
    height: 15px;
  }
  .seg .tx {
    white-space: pre;
    color: #e6edf3;
  }
  .lrow.unmatched .um {
    color: #6b7482;
    font-style: italic;
    padding-top: 14px;
  }
  .exports {
    margin-top: 12px;
  }
  .tabs {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }
  .tab {
    background: #0f1218;
    color: #9aa6b2;
    border: 1px solid #2a3340;
    border-radius: 7px;
    padding: 4px 10px;
    cursor: pointer;
    font-size: 0.8rem;
  }
  .tab.on {
    border-color: #4fd1c5;
    color: #cdeef0;
  }
  .exout {
    margin: 0 0 8px;
    max-height: 150px;
    overflow: auto;
    background: #0b0f16;
    border: 1px solid #1c232e;
    border-radius: 8px;
    padding: 8px 10px;
    font: 0.72rem/1.45 var(--mono);
    white-space: pre;
    color: #cfd7e2;
  }
  .exbtns {
    display: flex;
    gap: 8px;
    align-items: center;
  }
  .btn {
    background: #0f1218;
    color: #e6edf3;
    border: 1px solid #2a3340;
    border-radius: 7px;
    padding: 5px 11px;
    cursor: pointer;
    font-size: 0.82rem;
  }
  .btn:hover {
    border-color: #4fd1c5;
  }
  .btn.use {
    background: #1b3326;
    border-color: #2f6b45;
    color: #bdf0cf;
    font-weight: 600;
  }
  .flash {
    color: #9fe0b0;
    font-size: 0.8rem;
  }
</style>
