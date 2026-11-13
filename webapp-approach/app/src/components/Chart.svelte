<script lang="ts">
  import { session } from '../session.svelte';
  import { objectIndexAt, nextStart } from '../lib/model';
  import { view, currentObjects, roles, addRole, cloneInto, cloneSources, meta } from '../view.svelte';
  import { chordSvg } from '../lib/chordDiagram';
  import { sheet } from '../lib/serialize';
  import { copyText } from '../lib/clipboard';
  import ObjectView from './ObjectView.svelte';
  import ChartEdit from './ChartEdit.svelte';
  const s = session!;
  const objects = $derived(currentObjects());
  const roleLabel = $derived(roles.find((r) => r.id === view.roleId)?.label ?? view.roleId);

  let newRole = $state('');
  function addRoleNow() {
    const id = addRole(newRole);
    newRole = '';
    view.editing = false;
    view.roleId = id;
  }

  let chartH = $state(360);
  let els = $state<HTMLElement[]>([]);
  let chartEl = $state<HTMLElement | undefined>(undefined);

  const idx = $derived(objectIndexAt(objects, s.playhead));

  // Auto-scroll to the playhead by setting real scrollTop, so the chart stays a
  // normal scroll container the user can also scroll by hand. This runs only when
  // the playhead MOVES — every frame while playing, and once per seek. When paused
  // the playhead is constant, so manual scrolling is never fought. While playing we
  // disable manual scroll (.chart.playing { overflow: hidden }); programmatic
  // scrollTop still works. Heights vary, so we read the active element's real
  // offsetTop/height rather than assume a fixed line height.
  $effect(() => {
    const ph = s.playhead; // dependency: re-run when the playhead moves
    const h = chartH; // dependency: re-center on resize
    const el = els[idx];
    if (!chartEl || idx < 0 || !el) return;
    const start = objects[idx].startSec;
    const end = nextStart(objects, idx, meta.base.lengthSec);
    const frac = Math.min(1, Math.max(0, (ph - start) / Math.max(0.001, end - start)));
    chartEl.scrollTop = el.offsetTop + frac * el.offsetHeight - h / 2;
  });

  // Double-click a line/label to jump the whole band there. (Single-click and
  // click-drag stay free for selecting text.) preventDefault + clearing the
  // selection stops the double-click from leaving a highlighted word behind.
  function jumpTo(e: MouseEvent, obj: { startSec: number }) {
    e.preventDefault();
    window.getSelection()?.removeAllRanges();
    if (s.seat === 'maestro') s.seek(obj.startSec);
    else s.askSeek(obj.startSec);
  }

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
    const ok = await copyText(sheet(meta.title, objects));
    copied = ok;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1600);
  }
</script>

<div class="toolbar">
  <label class="role-pick"
    >Role
    <select bind:value={view.roleId}>
      {#each roles as r}<option value={r.id}>{r.label}</option>{/each}
    </select>
  </label>
  <input
    class="new-role"
    placeholder="+ role"
    bind:value={newRole}
    onkeydown={(e) => e.key === 'Enter' && newRole.trim() && addRoleNow()}
  />
  {#if newRole.trim()}
    <button class="copy-btn" onclick={addRoleNow}>Add</button>
  {/if}
  <span class="spacer"></span>
  {#if !view.editing}
    <span class="hint">Select any text to copy — or</span>
    <button class="copy-btn" onclick={copySheet}>{copied ? '✓ Copied' : '⧉ Copy sheet'}</button>
  {/if}
  <button class="copy-btn" onclick={() => (view.editing = !view.editing)}>
    {view.editing ? '✕ Close' : '✎ Edit'}
  </button>
</div>

{#if view.editing}
  <ChartEdit />
{:else if objects.length === 0}
  <div class="empty">
    <p>No chart for <b>{roleLabel}</b> yet. Start it from:</p>
    <div class="clone-row">
      {#each cloneSources(view.roleId) as src}
        <button class="clone-btn" onclick={() => cloneInto(view.roleId, src.key)}>⎘ {src.label}</button>
      {/each}
    </div>
    <p class="sub">Then press ✎ Edit to add this part's chords / strum, and Hand off to share.</p>
  </div>
{:else}
  <div
    class="chart"
    class:playing={s.uiState === 'playing'}
    bind:this={chartEl}
    bind:clientHeight={chartH}
  >
    <div
      class="scroller"
      style:padding-top={`${chartH / 2}px`}
      style:padding-bottom={`${chartH / 2}px`}
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
{/if}

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
    gap: 10px;
    margin-bottom: 8px;
    user-select: none;
  }
  .toolbar .spacer {
    flex: 1;
  }
  .toolbar .hint {
    color: #8b93a3;
    font-size: 0.78rem;
  }
  .role-pick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    color: #8b93a3;
  }
  .role-pick select {
    background: #0f1218;
    color: #e6edf3;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 4px 8px;
    font-size: 0.82rem;
  }
  .new-role {
    width: 90px;
    background: #0f1218;
    color: #e6edf3;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 4px 8px;
    font-size: 0.82rem;
  }
  .empty {
    height: 56vh;
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
    overflow: auto; /* real scrolling: by hand when paused, programmatic when playing */
    overscroll-behavior: contain;
    border: 1px solid #2a2f3a;
    border-radius: 10px;
    background: #0f1218;
    -webkit-mask-image: linear-gradient(transparent, #000 14%, #000 86%, transparent);
    mask-image: linear-gradient(transparent, #000 14%, #000 86%, transparent);
  }
  .chart.playing {
    overflow: hidden; /* follow the playhead; no hand-scrolling during playback */
  }
  .scroller {
    min-width: 100%;
    width: max-content;
    padding-left: 18px;
    padding-right: 18px;
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
