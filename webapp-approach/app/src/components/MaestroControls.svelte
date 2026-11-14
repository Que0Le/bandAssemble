<script lang="ts">
  import { session } from '../session.svelte';
  const s = session!;
</script>

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
</div>
