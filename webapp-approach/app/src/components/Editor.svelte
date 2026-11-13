<script lang="ts">
  import { onDestroy } from 'svelte';
  import { objectIndexAt } from '../lib/model';
  import type { SongObject } from '../lib/model';
  import {
    roles,
    charts,
    resetProject,
    meta,
    saveProjectFile,
    openProjectFile,
    setChart,
  } from '../view.svelte';
  import { parseSheet, autoTime } from '../lib/parseSheet';
  import { objectsText } from '../lib/serialize';
  import { copyText } from '../lib/clipboard';
  import ObjectView from './ObjectView.svelte';

  const r2 = (n: number) => Math.round(n * 100) / 100;

  // Open on the Role passed from the chart's "Full editor…" button (?role=…),
  // falling back to the first Role. Guard an empty roles list.
  const params = new URLSearchParams(location.search);
  const firstRole = roles[0]?.id ?? '';
  const wanted = params.get('role');
  const startRole = wanted && roles.some((r) => r.id === wanted) ? wanted : firstRole;
  const initialSheet = objectsText(charts[startRole] ?? []);
  let roleId = $state(startRole);
  let title = $state(meta.title);

  async function onOpen(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      await openProjectFile(f); // validates, persists, reloads
    } catch (err) {
      note((err as Error).message);
    }
  }
  let sheet = $state(initialSheet);
  let objects = $state<SongObject[]>(autoTime(parseSheet(initialSheet)));

  // audio for tap-to-time
  let audioEl = $state<HTMLAudioElement | undefined>(undefined);
  let audioUrl = $state('');
  let audioName = $state('');
  let playing = $state(false);
  let curTime = $state(0);
  let tapIdx = $state(0);

  let copied = $state('');
  let flash: ReturnType<typeof setTimeout> | undefined;
  function note(msg: string) {
    copied = msg;
    clearTimeout(flash);
    flash = setTimeout(() => (copied = ''), 1600);
  }

  const activeIdx = $derived(objectIndexAt(objects, curTime));

  function parse() {
    objects = autoTime(parseSheet(sheet));
    tapIdx = 0;
    note('parsed ' + objects.length + ' objects');
  }
  function loadRole() {
    sheet = objectsText(charts[roleId] ?? []);
    parse();
    note('loaded ' + roleId + ' chart');
  }

  function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(f);
    audioName = f.name;
    curTime = 0;
  }
  function togglePlay() {
    if (!audioEl) return;
    if (playing) audioEl.pause();
    else audioEl.play();
  }
  function seekTo(sec: number) {
    if (audioEl) audioEl.currentTime = Math.max(0, sec);
  }

  // Stamp the next object's start at the current audio time; close the previous.
  function tap() {
    if (tapIdx >= objects.length) return;
    const tt = r2(audioEl ? audioEl.currentTime : curTime);
    objects[tapIdx].startSec = tt;
    if (tapIdx > 0) objects[tapIdx - 1].endSec = tt;
    tapIdx++;
    // give the last object a sensible end if we just stamped it
    if (tapIdx === objects.length) objects[tapIdx - 1].endSec = r2(tt + 3);
  }
  function resetTaps() {
    tapIdx = 0;
    note('tap pointer reset');
  }

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return;
    if (e.code === 'Space') {
      e.preventDefault();
      tap();
    }
  }

  function removeObj(i: number) {
    objects = objects.filter((_, j) => j !== i);
    if (tapIdx > objects.length) tapIdx = objects.length;
  }

  function preview(o: SongObject): string {
    if (o.type === 'label') return '[' + o.text + ']';
    if (o.type === 'tab') return 'tab · ' + o.lines.length + ' rows';
    return o.text || o.strum || (o.note ? '(' + o.note + ')' : '(empty)');
  }

  async function copySheet() {
    const ok = await copyText(`${title}\n\n${objectsText(objects)}`);
    note(ok ? 'sheet copied' : 'copy failed');
  }
  async function copyJson() {
    const ok = await copyText(JSON.stringify({ title, roleId, objects }, null, 2));
    note(ok ? 'chart JSON copied' : 'copy failed');
  }

  // Commit the edited objects into the project store (+ localStorage) — the single
  // source of truth the chart viewer and Save file both read. Without this, the
  // tap-to-time work here never leaves the Editor (the old Save-file trap).
  function saveToProject() {
    setChart(roleId, objects);
    note('saved ' + roleId + ' to project');
  }
  function saveFile() {
    setChart(roleId, objects); // the download must reflect these edits
    saveProjectFile();
  }
  function goBack() {
    if (history.length > 1) history.back();
    else location.href = location.pathname; // no history → role chooser
  }

  onDestroy(() => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  });
</script>

<svelte:window onkeydown={onKey} />

<section class="editor">
  <div class="ed-head">
    <button class="btn" onclick={goBack} title="Back to the band view">← Back</button>
    <input class="title-in" bind:value={title} aria-label="song title" />
    <label class="role-sel"
      >Role
      <select bind:value={roleId}>
        {#each roles as r}<option value={r.id}>{r.label}</option>{/each}
      </select>
    </label>
    <button class="btn" onclick={loadRole}>Load role</button>
    <div class="spacer"></div>
    <button
      class="btn save"
      onclick={saveToProject}
      title="Write these edits into the project (and this browser)">✓ Save to project</button
    >
    <button class="btn" onclick={copySheet}>⧉ Copy sheet</button>
    <button class="btn" onclick={saveFile} title="Download the whole project as a file (includes these edits)"
      >⤓ Save file</button
    >
    <label class="btn open-lbl" title="Open a project file (replaces the current one)"
      >⤒ Open file<input type="file" accept="application/json,.json" onchange={onOpen} /></label
    >
    <button class="btn" onclick={copyJson}>⧉ Copy JSON</button>
    <button class="btn" onclick={resetProject} title="Discard saved changes, reload the sample"
      >↺ Reset</button
    >
    {#if copied}<span class="flash">{copied}</span>{/if}
  </div>

  <div class="ed-grid">
    <!-- left: paste + parse -->
    <div class="panel">
      <h2>Sheet (paste or type)</h2>
      <textarea
        class="sheet"
        bind:value={sheet}
        spellcheck="false"
        placeholder={'[Verse]\n[G]Lyrics with inline [C]chords\n↓ ↓↑ ↓↑\n(a note)'}
      ></textarea>
      <div class="row">
        <button class="btn" onclick={parse}>Parse → objects</button>
        <span class="hint">Chords inline as [G]. Sections as [Verse]. Strum ↓↑×. Notes (…).</span>
      </div>
    </div>

    <!-- right: timing + tap -->
    <div class="panel">
      <h2>Timing</h2>
      <div class="row">
        <label class="file">load audio <input type="file" accept="audio/*" onchange={onFile} /></label>
        {#if audioName}<span class="hint">{audioName}</span>{/if}
      </div>
      {#if audioUrl}
        <audio
          bind:this={audioEl}
          src={audioUrl}
          ontimeupdate={() => (curTime = audioEl ? audioEl.currentTime : 0)}
          onplay={() => (playing = true)}
          onpause={() => (playing = false)}
          onended={() => (playing = false)}
        ></audio>
        <div class="row tap-row">
          <button class="btn" onclick={togglePlay}>{playing ? '⏸' : '▶'}</button>
          <b class="clock">{curTime.toFixed(2)}s</b>
          <button class="btn tap" onclick={tap} disabled={tapIdx >= objects.length}>⏱ Tap (space)</button>
          <button class="btn" onclick={resetTaps}>reset</button>
        </div>
        <p class="hint next">
          {#if tapIdx < objects.length}
            Next tap → #{tapIdx + 1}: <span class="nx">{preview(objects[tapIdx])}</span>
          {:else}
            all {objects.length} stamped
          {/if}
        </p>
      {:else}
        <p class="hint">Load an audio file to tap-to-time, or edit the seconds directly below.</p>
      {/if}

      <div class="tbl">
        {#each objects as o, i (o.id)}
          <div class="trow" class:on={i === activeIdx} class:next={i === tapIdx}>
            <span class="k {o.type}">{o.type}</span>
            <span class="c">{preview(o)}</span>
            <input
              class="t"
              type="number"
              step="0.1"
              value={o.startSec}
              onchange={(e) => (o.startSec = +(e.currentTarget as HTMLInputElement).value)}
            />
            <input
              class="t"
              type="number"
              step="0.1"
              value={o.endSec}
              onchange={(e) => (o.endSec = +(e.currentTarget as HTMLInputElement).value)}
            />
            <button class="x" title="seek" onclick={() => seekTo(o.startSec)}>▸</button>
            <button class="x" title="remove" onclick={() => removeObj(i)}>✕</button>
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- preview -->
  <div class="panel">
    <h2>Preview</h2>
    <div class="prev">
      {#each objects as o, i (o.id)}
        <div class="pobj" class:on={i === activeIdx}>
          <ObjectView obj={o} />
        </div>
      {/each}
    </div>
  </div>
</section>

<style>
  .editor {
    max-width: 1100px;
    margin: 0 auto;
    padding: 16px;
  }
  .ed-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }
  .ed-head .spacer {
    flex: 1;
  }
  .title-in {
    font-size: 1.1rem;
    font-weight: 650;
    background: #0f1218;
    color: #e6edf3;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 6px 10px;
    min-width: 260px;
  }
  .flash {
    color: #9fe0b0;
    font-size: 0.82rem;
  }
  .role-sel {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: #8b93a3;
    font-size: 0.85rem;
  }
  .role-sel select {
    background: #0f1218;
    color: #e6edf3;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 5px 8px;
  }
  .open-lbl {
    cursor: pointer;
  }
  .open-lbl input {
    display: none;
  }
  .ed-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
  }
  @media (max-width: 820px) {
    .ed-grid {
      grid-template-columns: 1fr;
    }
  }
  .sheet {
    width: 100%;
    height: 320px;
    resize: vertical;
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    font-size: 0.92rem;
    line-height: 1.5;
    color: #e8edf5;
    background: #0f1218;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .file input {
    max-width: 180px;
  }
  .tap-row {
    align-items: center;
  }
  .clock {
    font-variant-numeric: tabular-nums;
    min-width: 64px;
  }
  .btn.tap,
  .btn.save {
    background: #1b3326;
    border-color: #2f6b45;
    color: #bdf0cf;
  }
  .next .nx {
    color: #ffcf6b;
  }
  .tbl {
    margin-top: 10px;
    max-height: 300px;
    overflow: auto;
    border-top: 1px solid #1c232e;
  }
  .trow {
    display: grid;
    grid-template-columns: 54px 1fr 68px 68px 26px 26px;
    gap: 6px;
    align-items: center;
    padding: 4px 2px;
    border-bottom: 1px solid #161c25;
  }
  .trow.on {
    background: #14202b;
  }
  .trow.next .c {
    color: #ffcf6b;
  }
  .k {
    font-size: 0.66rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8b93a3;
    border: 1px solid #28303c;
    border-radius: 6px;
    padding: 1px 4px;
    text-align: center;
  }
  .k.label {
    color: #7fd0ff;
    border-color: #28506a;
  }
  .k.tab {
    color: #c9a7ff;
    border-color: #4a3a6b;
  }
  .c {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: #d6dde8;
    font-size: 0.9rem;
  }
  .t {
    width: 100%;
    background: #0f1218;
    color: #e6edf3;
    border: 1px solid #2a3340;
    border-radius: 6px;
    padding: 3px 4px;
    font-variant-numeric: tabular-nums;
    font-size: 0.82rem;
  }
  .x {
    cursor: pointer;
    background: transparent;
    border: 1px solid #2a3340;
    color: #9aa6b2;
    border-radius: 6px;
    font-size: 0.72rem;
    padding: 2px 0;
  }
  .x:hover {
    border-color: #4fd1c5;
  }
  .prev {
    max-height: 40vh;
    overflow: auto;
    padding: 4px 6px;
  }
  .pobj {
    padding: 5px 8px;
    border-radius: 6px;
    opacity: 0.6;
  }
  .pobj.on {
    opacity: 1;
    background: #161f2a;
  }
</style>
