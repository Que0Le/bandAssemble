<script lang="ts">
  // Presentational: renders one SongObject's content (label / inline-chord line
  // + strum + note / tab) as selectable Unicode text. Shared by the player Chart
  // and the Editor preview. Chord hover is reported via callbacks so the parent
  // owns any tooltip.
  import type { SongObject } from '../lib/model';
  import { parseInline } from '../lib/chords';
  import { chordSvg } from '../lib/chordDiagram';

  let {
    obj,
    onChordEnter,
    onChordLeave,
  }: {
    obj: SongObject;
    onChordEnter?: (e: MouseEvent, chord: string) => void;
    onChordLeave?: () => void;
  } = $props();
</script>

{#if obj.type === 'label'}
  <div class="label-tag">{obj.text}</div>
{:else if obj.type === 'tab'}
  {#if obj.caption}<div class="note">{obj.caption}</div>{/if}
  <pre class="tab">{obj.lines.join('\n')}</pre>
{:else if obj.type === 'chorddef'}
  {@const svg = chordSvg(obj.name, { [obj.name]: obj.grip })}
  <div class="chorddef" title={`${obj.name}  ${obj.grip}`}>
    {#if svg}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html svg}
    {:else}
      <span class="cd-text">{obj.name} [{obj.grip}]</span>
    {/if}
  </div>
{:else}
  {#if obj.kind && obj.kind !== 'lyric'}<div class="kind-chip">{obj.kind}</div>{/if}
  {#if obj.text}
    <div class="text">
      {#each parseInline(obj.text) as seg}{#if seg.chord}<span
            class="chord"
            role="img"
            aria-label={`chord ${seg.chord}`}
            onmouseenter={(e) => onChordEnter?.(e, seg.chord!)}
            onmouseleave={() => onChordLeave?.()}>[{seg.chord}]</span
          >{/if}<span class="word">{seg.text}</span>{/each}
    </div>
  {/if}
  {#if obj.strum}<div class="strum">{obj.strum}</div>{/if}
  {#if obj.note}<div class="note">{obj.note}</div>{/if}
{/if}

<style>
  .label-tag {
    display: inline-block;
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: #7fd0ff;
    border: 1px solid #28506a;
    border-radius: 999px;
    padding: 2px 10px;
  }
  /* One monospace grid for the whole line, so chords, lyrics and the strum row
     line up character-for-character — true alignment, no proportional drift. */
  .text {
    font-family: var(--mono);
    font-size: 1rem;
    line-height: 1.5;
    color: #e8edf5;
    white-space: pre;
  }
  /* Chord: same monospace cell as the lyric, but bold + colored. */
  .chord {
    color: #ffcf6b;
    font-weight: 700;
    cursor: help;
  }
  .chord:hover {
    color: #ffe29a;
  }
  .strum {
    font-family: var(--mono);
    font-size: 1rem;
    line-height: 1.5;
    color: #9fe0b0;
    margin-top: 2px;
    /* preserve the author's spaces so strokes align to the words above */
    white-space: pre;
  }
  .note {
    font-size: 0.82rem;
    font-style: italic;
    color: #8b93a3;
    margin-top: 2px;
  }
  /* Phones: trim the monospace grid, and let long lines WRAP rather than run off
     the side. Chords are inline with their words, so a wrap keeps them together;
     per-character strum alignment is necessarily approximate once a line wraps,
     which is the right trade on a narrow screen (readable beats pixel-aligned). */
  @media (max-width: 640px) {
    .text,
    .strum {
      font-size: 0.85rem;
      white-space: pre-wrap; /* keep the author's spaces, but allow wrapping */
      overflow-wrap: anywhere; /* break even a single over-long token */
    }
  }
  /* A typed (non-lyric) flow line, e.g. solo / instrumental. */
  .kind-chip {
    display: inline-block;
    font-size: 0.66rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #c9a7ff;
    border: 1px solid #4a3a6b;
    border-radius: 6px;
    padding: 1px 7px;
    margin-bottom: 2px;
  }
  /* A custom chord fingering, shown as its diagram. */
  .chorddef {
    display: inline-block;
    vertical-align: top;
    margin: 2px 8px 2px 0;
  }
  .cd-text {
    font-family: var(--mono);
    color: #ffcf6b;
    font-size: 0.85rem;
  }
  .tab {
    font-family: var(--mono);
    font-size: 0.86rem;
    line-height: 1.25;
    color: #cfd6e2;
    margin: 2px 0 0;
    white-space: pre;
    user-select: text;
  }
</style>
