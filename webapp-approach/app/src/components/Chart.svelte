<script lang="ts">
  import { session } from '../session.svelte';
  import { objectIndexAt } from '../lib/model';
  import { view, currentObjects, roles, cloneInto, cloneSources } from '../view.svelte';
  import { chordSvg } from '../lib/chordDiagram';
  import ObjectView from './ObjectView.svelte';
  import ChartEdit from './ChartEdit.svelte';
  import ChartToolbar from './ChartToolbar.svelte';
  const s = session!;
  const objects = $derived(currentObjects());
  const roleLabel = $derived(roles.find((r) => r.id === view.roleId)?.label ?? view.roleId);

  // ---- Two-page horizontal viewer -------------------------------------------
  // The chart is NOT a teleprompter. Objects flow top->bottom into a column, wrap
  // into the next column to the right (CSS multi-column, column-fill:auto), so the
  // whole part becomes a wide strip of fixed-height pages. We show two pages at a
  // time and the strip only moves when the music crosses from one page into the
  // next: the finished page glides off the left, the next page is revealed on the
  // right ("dwell, then glide"). No per-line scrolling. The active line is kept on
  // the LEFT page, so the RIGHT page is always a look-ahead.
  const GAP = 32; // must match .pages column-gap
  const EASE = 0.1; // glide speed (0..1 per frame); lower = slower
  let pagesW = $state(0); // inner width of the column area (no horizontal padding)
  let chartEl = $state<HTMLElement | undefined>(undefined);
  let pagesEl = $state<HTMLElement | undefined>(undefined);
  let els = $state<HTMLElement[]>([]);

  // Two pages must fit exactly: 2*colW + gap = pagesW. If colW is even a hair too
  // wide the browser drops to a single full-width column, so measure and divide.
  const colW = $derived(Math.max(240, Math.floor((pagesW - GAP) / 2)));
  const step = $derived(colW + GAP); // horizontal distance of one page

  const idx = $derived(objectIndexAt(objects, s.playhead));

  // Column (page) index that the active object lives in, in content space.
  let committedCol = 0;
  let targetLeft = $state(0);

  // Pick the target page whenever the playhead moves (every frame while playing,
  // once per seek). We read the active element's real x rather than assume a page
  // width in objects, because page breaks depend on measured heights.
  let lastPh = -1;
  $effect(() => {
    const ph = s.playhead; // dep: re-run as the playhead advances
    void step; // dep: recompute on resize
    void pagesW;
    const el = els[idx];
    if (!chartEl || !pagesEl || idx < 0 || !el || step <= 0) return;
    const x = el.getBoundingClientRect().left - pagesEl.getBoundingClientRect().left;
    committedCol = Math.max(0, Math.round(x / step));
    const max = Math.max(0, chartEl.scrollWidth - chartEl.clientWidth);
    targetLeft = Math.min(committedCol * step, max);
    // While playing, the ease loop below glides toward targetLeft. While paused we
    // must NOT re-assert the page every frame or hand-paging gets yanked back — only
    // follow a real seek (a meaningful jump in the playhead), not frame jitter.
    if (s.uiState !== 'playing' && Math.abs(ph - lastPh) > 0.08) {
      chartEl.scrollTo({ left: targetLeft, behavior: 'smooth' });
    }
    lastPh = ph;
  });

  // Ease loop: while playing, glide scrollLeft toward the target page. Runs once
  // (no reactive deps read at setup); reads live values each frame. When paused it
  // does nothing, so hand-scrolling is never fought.
  $effect(() => {
    let raf = requestAnimationFrame(function tick() {
      if (chartEl && s.uiState === 'playing') {
        const d = targetLeft - chartEl.scrollLeft;
        if (Math.abs(d) > 0.5) chartEl.scrollLeft += d * EASE;
      }
      raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  });

  // Double-click a line/label to jump the whole band there. (Single-click and
  // click-drag stay free for selecting text.)
  function jumpTo(e: MouseEvent, obj: { startSec: number }) {
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    if (s.seat === 'maestro') s.seek(obj.startSec);
    else s.askSeek(obj.startSec);
  }

  // Manual page flip when paused (buttons + arrow keys).
  function flip(dir: -1 | 1) {
    if (!chartEl) return;
    const max = Math.max(0, chartEl.scrollWidth - chartEl.clientWidth);
    targetLeft = Math.min(Math.max(0, Math.round(chartEl.scrollLeft / step + dir) * step), max);
    chartEl.scrollTo({ left: targetLeft, behavior: 'smooth' });
  }
  function onKey(e: KeyboardEvent) {
    if (view.editing) return;
    if (e.key === 'ArrowRight') flip(1);
    else if (e.key === 'ArrowLeft') flip(-1);
  }

  // Chord tooltip (fixed-positioned so it escapes the chart's overflow:hidden).
  let tip = $state<{ x: number; y: number; html: string; name: string } | null>(null);
  function showTip(e: MouseEvent, chord: string) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    tip = { x: r.left + r.width / 2, y: r.top, name: chord, html: chordSvg(chord) ?? '' };
  }
  const hideTip = () => (tip = null);
</script>

<svelte:window onkeydown={onKey} />

<div class="wrap">
  <ChartToolbar />

  {#if view.editing}
    <div class="edit-scroll"><ChartEdit /></div>
  {:else if objects.length === 0}
    <div class="empty">
      <p>No chart for <b>{roleLabel}</b> yet. Start it from:</p>
      <div class="clone-row">
        {#each cloneSources(view.roleId) as src}
          <button class="clone-btn" onclick={() => cloneInto(view.roleId, src.key)}
            >⎘ {src.label}</button
          >
        {/each}
      </div>
      <p class="sub">Then press ✎ Edit to add this part's chords / strum, and Hand off to share.</p>
    </div>
  {:else}
    <div class="stage">
      <div
        class="chart"
        class:playing={s.uiState === 'playing'}
        bind:this={chartEl}
      >
        <div
          class="pages"
          bind:this={pagesEl}
          bind:clientWidth={pagesW}
          style:column-width={`${colW}px`}
        >
          {#each objects as obj, i (obj.id)}
            <!-- svelte-ignore a11y_click_events_have_key_events -->
            <div
              class="obj"
              class:active={i === idx}
              role="button"
              tabindex="-1"
              bind:this={els[i]}
              ondblclick={(e) => jumpTo(e, obj)}
            >
              <ObjectView {obj} onChordEnter={showTip} onChordLeave={hideTip} />
            </div>
          {/each}
        </div>
      </div>
      {#if s.uiState !== 'playing'}
        <button class="pager left" title="Previous page (←)" onclick={() => flip(-1)}>‹</button>
        <button class="pager right" title="Next page (→)" onclick={() => flip(1)}>›</button>
      {/if}
    </div>
  {/if}
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
  .wrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
    height: 100%;
    min-height: 0;
  }
  .edit-scroll {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;
    border: 1px dashed #2a3340;
    border-radius: 10px;
    color: #cfd6e2;
    text-align: center;
    padding: 0 20px;
  }
  .empty .sub {
    color: #8b93a3;
    font-size: 0.82rem;
    margin: 0;
    max-width: 320px;
  }
  .clone-row {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    justify-content: center;
  }
  .clone-btn {
    cursor: pointer;
    background: #1b3326;
    border: 1px solid #2f6b45;
    color: #bdf0cf;
    border-radius: 8px;
    padding: 9px 16px;
    font-size: 0.95rem;
  }
  .clone-btn:hover {
    border-color: #4fd1c5;
  }

  .stage {
    position: relative;
    flex: 1;
    min-height: 0;
  }
  .chart {
    height: 100%;
    overflow-x: auto; /* hand-scroll when paused; programmatic glide when playing */
    overflow-y: hidden;
    overscroll-behavior: contain;
    border: 1px solid #2a2f3a;
    border-radius: 10px;
    background: #0f1218;
    /* fade the vertical page edges a touch */
    -webkit-mask-image: linear-gradient(90deg, transparent, #000 2%, #000 98%, transparent);
    mask-image: linear-gradient(90deg, transparent, #000 2%, #000 98%, transparent);
  }
  .chart.playing {
    overflow-x: hidden; /* the music drives the page; no hand-scroll while playing */
  }
  /* CSS multi-column: content fills one column top-to-bottom, then the next to the
     right, extending the strip horizontally into pages. */
  .pages {
    height: 100%;
    column-gap: 32px; /* must match GAP */
    column-fill: auto;
    /* no horizontal padding: the measured width must equal the two columns + gap */
    padding: 14px 0;
  }
  .obj {
    padding: 6px 10px;
    border-radius: 8px;
    border-left: 3px solid transparent;
    user-select: text;
    /* never split a line/label/tab across the page fold */
    break-inside: avoid;
    -webkit-column-break-inside: avoid;
    transition:
      background 0.2s linear,
      border-color 0.2s linear;
  }
  /* A light wash + accent bar for the current line — enough to find your place,
     not a glaring block (the rest of the page stays fully readable to look ahead). */
  .obj.active {
    background: rgba(79, 209, 197, 0.08);
    border-left-color: rgba(79, 209, 197, 0.55);
  }

  .pager {
    position: absolute;
    top: 50%;
    transform: translateY(-50%);
    width: 34px;
    height: 56px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    cursor: pointer;
    color: #cfd6e2;
    background: rgba(18, 24, 32, 0.9);
    border: 1px solid #2a3b4e;
    border-radius: 10px;
    opacity: 0; /* reveal on hover so they don't cover lyrics while reading */
    transition: opacity 0.15s linear;
  }
  .stage:hover .pager {
    opacity: 1;
  }
  .pager:hover {
    border-color: #4fd1c5;
  }
  .pager.left {
    left: 8px;
  }
  .pager.right {
    right: 8px;
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
