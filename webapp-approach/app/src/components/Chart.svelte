<script lang="ts">
  import { session } from '../session.svelte';
  import { PROJECT, objectIndexAt, nextStart } from '../lib/model';
  import { chordSvg } from '../lib/chordDiagram';
  import { projectText } from '../lib/serialize';
  import { copyText } from '../lib/clipboard';
  import ObjectView from './ObjectView.svelte';
  const s = session!;
  const objects = PROJECT.objects;

  let chartH = $state(360);
  let els = $state<HTMLElement[]>([]);

  const idx = $derived(objectIndexAt(objects, s.playhead));

  // Center-lock scroll: translate so the active object's current point sits at
  // the viewport middle. Heights vary (label / 1–3 row line / tab), so we read
  // the active element's real offsetTop + height instead of a fixed line height.
  const y = $derived.by(() => {
    const i = idx;
    const el = els[i];
    if (i < 0 || !el) return 0;
    const start = objects[i].startSec;
    const end = nextStart(PROJECT, i);
    const frac = Math.min(1, Math.max(0, (s.playhead - start) / Math.max(0.001, end - start)));
    return el.offsetTop + frac * el.offsetHeight;
  });

  // Chord tooltip (fixed-positioned so it escapes the chart's overflow:hidden).
  let tip = $state<{ x: number; y: number; html: string; name: string } | null>(null);
  function showTip(e: MouseEvent, chord: string) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    tip = { x: r.left + r.width / 2, y: r.top, name: chord, html: chordSvg(chord) ?? '' };
  }
  const hideTip = () => (tip = null);

  // Copy the whole arrangement as a plain-text chord sheet.
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copySheet() {
    const ok = await copyText(projectText(PROJECT));
    copied = ok;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1600);
  }
</script>

<div class="toolbar">
  <span class="hint">Select any text to copy — or</span>
  <button class="copy-btn" onclick={copySheet}>{copied ? '✓ Copied' : '⧉ Copy sheet'}</button>
</div>

<div class="chart" bind:clientHeight={chartH}>
  <div class="scroller" style:transform={`translateY(${chartH / 2 - y}px)`}>
    {#each objects as obj, i (obj.id)}
      <div class="obj" class:active={i === idx} bind:this={els[i]}>
        <ObjectView {obj} onChordEnter={showTip} onChordLeave={hideTip} />
      </div>
    {/each}
  </div>
</div>

{#if tip}
  <div class="chord-tip" style:left={`${tip.x}px`} style:top={`${tip.y}px`}>
    {#if tip.html}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -->
      {@html tip.html}
    {:else}
      <div class="no-diagram"><b>{tip.name}</b><span>no diagram yet</span></div>
    {/if}
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    margin-bottom: 8px;
    user-select: none;
  }
  .toolbar .hint {
    color: #8b93a3;
    font-size: 0.78rem;
  }
  .copy-btn {
    cursor: pointer;
    color: #cfe8ff;
    background: #182230;
    border: 1px solid #2a3b4e;
    border-radius: 8px;
    padding: 5px 12px;
    font-size: 0.82rem;
  }
  .copy-btn:hover {
    border-color: #4fd1c5;
  }
  .chart {
    position: relative;
    height: 56vh;
    overflow: hidden;
    border: 1px solid #2a2f3a;
    border-radius: 10px;
    background: #0f1218;
    -webkit-mask-image: linear-gradient(transparent, #000 14%, #000 86%, transparent);
    mask-image: linear-gradient(transparent, #000 14%, #000 86%, transparent);
  }
  .scroller {
    position: absolute;
    left: 0;
    right: 0;
    padding: 0 18px;
    will-change: transform;
  }
  /* Everything in the chart is real, selectable text. */
  .obj {
    padding: 8px 10px;
    border-radius: 8px;
    opacity: 0.5;
    user-select: text;
    transition:
      opacity 0.12s linear,
      background 0.12s linear;
  }
  .obj.active {
    opacity: 1;
    background: #1b2330;
  }
  .chord-tip {
    position: fixed;
    transform: translate(-50%, calc(-100% - 10px));
    background: #0b0e13;
    border: 1px solid #2a3340;
    border-radius: 10px;
    padding: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    z-index: 50;
  }
  .no-diagram {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-width: 72px;
  }
  .no-diagram b {
    color: #ffcf6b;
    font-size: 1.1rem;
  }
  .no-diagram span {
    color: #8b93a3;
    font-size: 0.72rem;
  }
</style>
