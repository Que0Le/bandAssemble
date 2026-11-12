<script lang="ts">
  import { session } from '../session.svelte';
  import { PROJECT, labels } from '../lib/model';
  const s = session!;
  const marks = labels(PROJECT.base.lyrics);

  async function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) await s.loadFile(f);
  }
</script>

<div class="row">
  <button class="btn" onclick={() => s.maestroPlay()}>▶ Play</button>
  <button class="btn" onclick={() => s.maestroPause()}>⏸ Pause</button>
  <button class="btn" onclick={() => s.restart()}>⏮ Restart</button>
</div>
<div class="row">
  <label>
    rate
    <input
      type="range"
      min="0.5"
      max="1"
      step="0.05"
      value={s.rate}
      oninput={(e) => s.setRate(parseFloat((e.currentTarget as HTMLInputElement).value))}
    />
  </label>
  <label>
    <input
      type="checkbox"
      checked={s.loopOn}
      onchange={(e) => s.toggleLoop((e.currentTarget as HTMLInputElement).checked)}
    /> loop section
  </label>
</div>
<div class="row">
  <label>
    <input
      type="checkbox"
      checked={s.metronome}
      onchange={(e) => s.toggleMetronome((e.currentTarget as HTMLInputElement).checked)}
    /> metronome
  </label>
  <label>load audio <input type="file" accept="audio/*" onchange={onFile} /></label>
</div>
<p class="hint">Markers (click to jump everyone):</p>
<div class="markers">
  {#each marks as m}
    <button class="btn" onclick={() => s.seek(m.atSec)}>{m.label} ({m.atSec}s)</button>
  {/each}
</div>
