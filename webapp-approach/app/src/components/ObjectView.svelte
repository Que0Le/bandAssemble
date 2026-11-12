<script lang="ts">
  // Presentational: renders one SongObject's content (label / inline-chord line
  // + strum + note / tab) as selectable Unicode text. Shared by the player Chart
  // and the Editor preview. Chord hover is reported via callbacks so the parent
  // owns any tooltip.
  import type { SongObject } from '../lib/model';
  import { parseInline } from '../lib/chords';

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
{:else}
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
  .text {
    font-size: 1.12rem;
    line-height: 1.5;
    color: #e8edf5;
  }
  /* Chord: same size as the lyric, but bold + colored. Bracketed, inline. */
  .chord {
    color: #ffcf6b;
    font-weight: 700;
    cursor: help;
  }
  .chord:hover {
    color: #ffe29a;
  }
  .word {
    white-space: pre-wrap;
  }
  .strum {
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    font-size: 1rem;
    letter-spacing: 0.08em;
    color: #9fe0b0;
    margin-top: 3px;
  }
  .note {
    font-size: 0.82rem;
    font-style: italic;
    color: #8b93a3;
    margin-top: 2px;
  }
  .tab {
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    font-size: 0.86rem;
    line-height: 1.25;
    color: #cfd6e2;
    margin: 2px 0 0;
    white-space: pre;
    user-select: text;
  }
</style>
