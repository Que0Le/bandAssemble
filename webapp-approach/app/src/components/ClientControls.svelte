<script lang="ts">
  import { session } from '../session.svelte';
  import { PROJECT, labels } from '../lib/model';
  const s = session!;
  const marks = labels(PROJECT.base.lyrics);
</script>

<p class="hint">Request the band to start from a section:</p>
<div class="markers">
  {#each marks as m}
    <button class="btn" onclick={() => s.jump(m.label)}>start @ {m.label}</button>
  {/each}
</div>
<div class="row">
  <button class="btn" onclick={() => s.askPlay()}>▶ Ask to play</button>
  <button class="btn" onclick={() => s.askPause()}>⏸ Ask to pause</button>
</div>
