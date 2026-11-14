<script lang="ts">
  // Sticky bottom transport bar: play / pause / restart + the section labels
  // (scroll horizontally when they overflow). Seat-aware — the Maestro acts
  // directly, a Player sends the same thing as an intent.
  import { session } from '../session.svelte';
  import { labels } from '../lib/model';
  import { meta } from '../view.svelte';
  const s = session!;
  const isMaestro = s.seat === 'maestro';

  const marks = $derived(labels(meta.base.lyrics));
  const activeIdx = $derived.by(() => {
    let a = -1;
    for (let i = 0; i < marks.length; i++) {
      if (marks[i].atSec <= s.playhead) a = i;
      else break;
    }
    return a;
  });

  function toggle() {
    if (s.uiState === 'playing') isMaestro ? s.maestroPause() : s.askPause();
    else isMaestro ? s.maestroPlay() : s.askPlay();
  }
  const restart = () => (isMaestro ? s.restart() : s.askSeek(0));
  const goto = (atSec: number) => (isMaestro ? s.seek(atSec) : s.askSeek(atSec));
</script>

<div class="bar">
  <div class="transport">
    <button
      class="t"
      class:on={s.uiState === 'playing'}
      onclick={toggle}
      title={s.uiState === 'playing' ? 'Pause' : 'Play'}>{s.uiState === 'playing' ? '⏸' : '▶'}</button
    >
    <button class="t" onclick={restart} title="Restart">⏮</button>
  </div>
  <div class="labels">
    {#each marks as m, i}
      <button class="chip" class:active={i === activeIdx} onclick={() => goto(m.atSec)}>{m.label}</button
      >
    {/each}
  </div>
</div>

<style>
  .bar {
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 40;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 16px;
    background: #121820;
    border-top: 1px solid #2a3340;
    box-shadow: 0 -6px 20px rgba(0, 0, 0, 0.4);
  }
  .transport {
    display: flex;
    gap: 8px;
    flex: none;
  }
  .t {
    cursor: pointer;
    width: 44px;
    height: 38px;
    font-size: 1rem;
    color: #e6edf3;
    background: #1b2430;
    border: 1px solid #2a3b4e;
    border-radius: 8px;
  }
  .t:hover {
    border-color: #4fd1c5;
  }
  .t.on {
    color: #48bb78;
    border-color: #48bb78;
  }
  .labels {
    flex: 1;
    display: flex;
    gap: 8px;
    overflow-x: auto;
    padding-bottom: 2px;
    scrollbar-width: thin;
  }
  .chip {
    flex: none;
    cursor: pointer;
    white-space: nowrap;
    font-size: 0.82rem;
    color: #cfd6e2;
    background: #182230;
    border: 1px solid #2a3b4e;
    border-radius: 999px;
    padding: 6px 14px;
  }
  .chip:hover {
    border-color: #4fd1c5;
  }
  .chip.active {
    color: #7fd0ff;
    border-color: #28506a;
    background: #16222e;
  }
</style>
