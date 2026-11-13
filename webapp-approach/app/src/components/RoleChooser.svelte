<script lang="ts">
  // Seat picker for the active project. Reached as ?project=<id> (no seat yet).
  // Each link keeps the project in the URL so the chosen seat opens it.
  import { meta } from '../view.svelte';
  const proj = new URLSearchParams(location.search).get('project');
  const q = (seat: string) => `?seat=${seat}${proj ? '&project=' + encodeURIComponent(proj) : ''}`;
</script>

<section id="chooser">
  <p class="proj">
    Project: <b>{meta.title}</b> · <a href={location.pathname}>← All projects</a>
  </p>
  <p>Open this page as:</p>
  <a class="btn big" href={q('maestro')}>🎛️ Maestro (laptop / audio)</a>
  <a class="btn big" href={q('player')}>📱 Player (follows)</a>
  <a class="btn big" href={q('editor')}>✏️ Editor (laptop)</a>
  <p class="hint">Open Maestro + Player in two windows; the editor builds the chart.</p>
</section>

<style>
  .proj {
    color: var(--muted, #8b93a3);
    font-size: 0.9rem;
  }
  .proj b {
    color: var(--fg, #e6edf3);
  }
  .proj a {
    color: var(--accent, #4fd1c5);
  }
</style>
