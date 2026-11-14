<script lang="ts">
  // Seat picker for the active project. Reached as ?project=<id> (no seat yet).
  // Each seat link keeps the project AND the shared session code in the URL, so a
  // real band on different devices lands in one relay room (see lib/join).
  import { meta } from '../view.svelte';
  import CopyLinkBox from './CopyLinkBox.svelte';
  import LoopbackWarning from './LoopbackWarning.svelte';
  import {
    rememberedCode,
    rememberCode,
    newSessionCode,
    normalizeCode,
    joinUrl,
    qrSvg,
  } from '../lib/join';

  const proj = new URLSearchParams(location.search).get('project');

  let code = $state(rememberedCode());
  $effect(() => rememberCode(code));

  // Seat link: carry the session code (so everyone shares a room) + the project.
  const q = (seat: string) => {
    const sp = new URLSearchParams();
    sp.set('seat', seat);
    if (code) sp.set('session', code);
    if (proj) sp.set('project', proj);
    return '?' + sp.toString();
  };

  const link = $derived(joinUrl(code));
  const qr = $derived(qrSvg(link));
</script>

<section id="chooser">
  <p class="proj">
    Project: <b>{meta.title}</b> · <a href={location.pathname}>← All projects</a>
  </p>

  <div class="code">
    <label for="sess">Session code</label>
    <input
      id="sess"
      value={code}
      oninput={(e) => (code = normalizeCode((e.target as HTMLInputElement).value))}
      maxlength="12"
      autocomplete="off"
      spellcheck="false"
    />
    <button class="mini" title="Generate a new code" onclick={() => (code = newSessionCode())}>⟳ new</button>
  </div>
  <p class="hint">Everyone in the band uses the <b>same</b> code — that's what puts you in one room.</p>

  <p>Open this page as:</p>
  <a class="btn big" href={q('maestro')}>🎛️ Maestro (laptop / audio)</a>
  <a class="btn big" href={q('player')}>📱 Player (follows)</a>
  <a class="btn big" href={q('editor')}>✏️ Editor (laptop)</a>

  <div class="join">
    <p class="jh">For players — scan to join as a Player:</p>
    <LoopbackWarning />
    <div class="qrow">
      <div class="qr">{@html qr}</div>
      <CopyLinkBox {link} label="Copy" />
    </div>
  </div>

  <p class="hint">Open Maestro + Player in two windows to test on one machine; the editor builds the chart.</p>
</section>

<style>
  #chooser {
    max-width: 560px;
  }
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
  .code {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 14px 0 2px;
  }
  .code label {
    font-size: 0.85rem;
    color: var(--muted, #8b93a3);
  }
  .code input {
    width: 7ch;
    font-family: ui-monospace, monospace;
    font-size: 1.15rem;
    letter-spacing: 0.12em;
    text-align: center;
    background: #0f1218;
    color: var(--fg, #e6edf3);
    border: 1px solid #2f4a5a;
    border-radius: 8px;
    padding: 6px 8px;
  }
  .mini {
    cursor: pointer;
    color: #cfe8ff;
    background: #182230;
    border: 1px solid #2a3b4e;
    border-radius: 8px;
    padding: 6px 10px;
    font-size: 0.8rem;
  }
  .mini:hover {
    border-color: #4fd1c5;
  }
  .hint {
    color: var(--muted, #8b93a3);
    font-size: 0.8rem;
  }
  .join {
    margin-top: 18px;
    padding-top: 14px;
    border-top: 1px solid #222a33;
  }
  .jh {
    font-size: 0.85rem;
    color: var(--fg, #e6edf3);
    margin: 0 0 8px;
  }
  .qrow {
    display: flex;
    gap: 14px;
    align-items: center;
    flex-wrap: wrap;
  }
  .qr {
    width: 148px;
    height: 148px;
    background: #fff;
    border-radius: 10px;
    padding: 6px;
    flex: none;
  }
  .qr :global(svg) {
    width: 100%;
    height: 100%;
    display: block;
  }
</style>
