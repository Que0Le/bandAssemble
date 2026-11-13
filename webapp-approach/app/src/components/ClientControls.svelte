<script lang="ts">
  import { session } from '../session.svelte';
  import { labels } from '../lib/model';
  import { meta } from '../view.svelte';
  const s = session!;
  const marks = labels(meta.base.lyrics);
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
