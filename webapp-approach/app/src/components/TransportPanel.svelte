<script lang="ts">
  import { session, SEAT } from '../session.svelte';
  const s = session!;
</script>

<div class="readout">
  <div><span>state</span><b>{s.uiState}</b></div>
  <div><span>playhead</span><b>{s.playhead.toFixed(2)}s</b></div>
  <div><span>rate</span><b>{s.rate.toFixed(2)}×</b></div>
  {#if SEAT === 'player'}
    <div><span>clock offset</span><b>{s.offset ? s.offset.toFixed(1) + ' ms' : '—'}</b></div>
    <div><span>best RTT</span><b>{Number.isFinite(s.rtt) ? s.rtt.toFixed(1) + ' ms' : '—'}</b></div>
    <div>
      <span>last sync</span>
      <b>{s.lastSync ? ((performance.now() - s.lastSync) / 1000).toFixed(0) + 's ago' : '—'}</b>
    </div>
  {:else}
    <div><span>clock</span><b>authoritative</b></div>
    <div><span>device</span><b>{s.deviceId}</b></div>
    <div><span>session</span><b>{s.sessionId}</b></div>
  {/if}
</div>
