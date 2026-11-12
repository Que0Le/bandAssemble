<script lang="ts">
  import { session } from '../session.svelte';
  import { SONG, lineIndexAt } from '../lib/song';
  const s = session!;
  const LINE_H = 42;
  let chartH = $state(360);

  const idx = $derived(lineIndexAt(s.playhead));
  const y = $derived.by(() => {
    const i = idx;
    if (i < 0) return 0;
    const l = SONG.lines[i];
    const nextAt = i < SONG.lines.length - 1 ? SONG.lines[i + 1].atSec : SONG.lengthSec;
    const frac = (s.playhead - l.atSec) / Math.max(0.001, nextAt - l.atSec);
    return (i + frac) * LINE_H;
  });
</script>

<div class="chart" bind:clientHeight={chartH}>
  <div class="scroller" style:transform={`translateY(${chartH / 2 - y}px)`}>
    {#each SONG.lines as ln, i}
      <div class="line" class:active={i === idx}>
        <span class="t">{ln.atSec.toFixed(0)}s</span>
        <span class="chord">{ln.chord}</span>
        <span class="lyric">{ln.lyric}</span>
      </div>
    {/each}
  </div>
</div>
