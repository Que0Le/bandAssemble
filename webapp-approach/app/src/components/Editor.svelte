<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
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
    setBase,
    setBaseAudio,
    activeId,
  } from '../view.svelte';
  import { getMediaUrl, putMedia, requestPersist } from '../lib/media';
  import { parseSheet, autoTime, reTime } from '../lib/parseSheet';
  import { objectsText } from '../lib/serialize';
  import { copyText } from '../lib/clipboard';
  import { r2 } from '../lib/util';
  import ObjectView from './ObjectView.svelte';

  // The edit target is either the Base (lyric/timing skeleton) or a Role's chart.
  // Open on ?role= (from the chart's "Full editor…" or the wizard); a project with
  // no Roles yet (fresh from the wizard) starts on the Base so there's content to sync.
  const BASE = '__base__';
  const params = new URLSearchParams(location.search);
  const wanted = params.get('role');
  function resolveTarget(): string {
    if (wanted === 'base' || wanted === BASE) return BASE;
    if (wanted && roles.some((r) => r.id === wanted)) return wanted;
    return roles.length === 0 ? BASE : roles[0].id;
  }
  const storedObjs = (target: string): SongObject[] =>
    target === BASE ? meta.base.lyrics : (charts[target] ?? []);
  const sheetFor = (target: string): string => objectsText(storedObjs(target));

  const startTarget = resolveTarget();
  const initialSheet = sheetFor(startTarget);
  let roleId = $state(startTarget);
  const isBase = $derived(roleId === BASE);
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
  // Preserve any existing per-object times on load (the text form carries none);
  // only the explicit "Parse" button below resets timing.
  let objects = $state<SongObject[]>(reTime(parseSheet(initialSheet), storedObjs(startTarget)));

  // audio / video for tap-to-time (a video is handy while syncing)
  let mediaEl = $state<HTMLMediaElement | undefined>(undefined);
  let audioUrl = $state('');
  let audioName = $state('');
  let mediaIsVideo = $state(false);
  // Project names a media file, but its bytes aren't on this device (imported as
  // text-only .band.json). Prompt the user to re-attach it with "load media".
  let mediaMissing = $state(false);
  let playing = $state(false);
  let curTime = $state(0);
  // The line currently being timed (the highlighted row). Click a row, or N/P,
  // to move it; S/E stamp start/end onto it. No auto-advance.
  let cur = $state(0);
  // Lines whose END the user set explicitly with E this session — so marking the
  // next line's start won't silently close the gap they just made. Not persisted.
  let explicitEnd = new Set<number>();

  let copied = $state('');
  let flash: ReturnType<typeof setTimeout> | undefined;
  function note(msg: string) {
    copied = msg;
    clearTimeout(flash);
    flash = setTimeout(() => (copied = ''), 1600);
  }

  const activeIdx = $derived(objectIndexAt(objects, curTime));

  // Explicit re-parse: resets timing to a sequential placeholder (use after a
  // structural text change, then re-tap). Loading a target preserves its times.
  function parse() {
    objects = autoTime(parseSheet(sheet));
    cur = 0;
    explicitEnd = new Set();
    note('parsed ' + objects.length + ' objects');
  }
  function loadRole() {
    sheet = sheetFor(roleId);
    objects = reTime(parseSheet(sheet), storedObjs(roleId));
    cur = 0;
    explicitEnd = new Set();
    note('loaded ' + (isBase ? 'Base' : roleId));
  }

  // Replace the project's media: store the blob in IndexedDB and note it on the Base.
  async function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    audioUrl = URL.createObjectURL(f);
    audioName = f.name;
    mediaIsVideo = f.type.startsWith('video/');
    mediaMissing = false;
    curTime = 0;
    const m = await putMedia(activeId, f);
    setBaseAudio(f.name, m.durationSec);
    void requestPersist(); // keep this (possibly large) blob from being evicted
    note('media stored · ' + f.name);
  }
  function togglePlay() {
    if (!mediaEl) return;
    if (playing) mediaEl.pause();
    else mediaEl.play();
  }
  function seekTo(sec: number) {
    if (mediaEl) mediaEl.currentTime = Math.max(0, sec);
  }

  const playhead = () => r2(mediaEl ? mediaEl.currentTime : curTime);

  // S — mark the current line's START at the playhead. Keep lines contiguous by
  // default: close the previous line here too, unless you set its end with E.
  function markStart() {
    if (!objects.length) return;
    const tt = playhead();
    objects[cur].startSec = tt;
    if (cur > 0 && !explicitEnd.has(cur - 1) && objects[cur - 1].endSec !== tt) {
      objects[cur - 1].endSec = tt;
    }
    if (objects[cur].endSec < tt) objects[cur].endSec = r2(tt + 3); // keep end ≥ start
  }
  // E — mark the current line's END at the playhead (use it to end a line before
  // the next starts — an instrumental gap). Remembered so S won't overwrite it.
  function markEnd() {
    if (!objects.length) return;
    objects[cur].endSec = playhead();
    explicitEnd.add(cur);
  }
  // N / P — move the current line; no stamping.
  function next() {
    if (cur < objects.length - 1) cur++;
  }
  function prev() {
    if (cur > 0) cur--;
  }
  function resetTaps() {
    cur = 0;
    explicitEnd = new Set();
    note('back to first line');
  }

  function onKey(e: KeyboardEvent) {
    const el = e.target as HTMLElement;
    if (el && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
    const k = e.key.toLowerCase();
    if (e.code === 'Space' || k === 's') {
      e.preventDefault();
      markStart();
    } else if (k === 'e') {
      e.preventDefault();
      markEnd();
    } else if (k === 'n') {
      e.preventDefault();
      next();
    } else if (k === 'p') {
      e.preventDefault();
      prev();
    }
  }

  function removeObj(i: number) {
    objects = objects.filter((_, j) => j !== i);
    explicitEnd = new Set(); // indices shifted; drop the (now-stale) end marks
    if (cur >= objects.length) cur = Math.max(0, objects.length - 1);
  }

  function preview(o: SongObject): string {
    if (o.type === 'label') return '[' + o.text + ']';
    if (o.type === 'chorddef') return o.name + ' [' + o.grip + ']';
    if (o.type === 'tab') return 'tab · ' + o.lines.length + ' rows';
    const kind = o.kind && o.kind !== 'lyric' ? '@' + o.kind + ' ' : '';
    return kind + (o.text || o.strum || (o.note ? '(' + o.note + ')' : '(empty)'));
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
  function commit() {
    if (isBase) setBase(objects);
    else setChart(roleId, objects);
  }
  function saveToProject() {
    commit();
    note('saved ' + (isBase ? 'Base' : roleId) + ' to project');
  }
  function saveFile() {
    commit(); // the download must reflect these edits
    saveProjectFile();
  }
  function goBack() {
    if (history.length > 1) history.back();
    else location.href = location.pathname; // no history → projects list
  }

  // Auto-load this project's stored media (audio or video) so the wizard hand-off
  // lands on a ready-to-sync screen — no re-picking the file.
  onMount(async () => {
    const got = await getMediaUrl(activeId);
    if (got) {
      audioUrl = got.url;
      audioName = got.meta.name;
      mediaIsVideo = got.meta.type.startsWith('video/');
    } else if (meta.base.audio) {
      // referenced but not on this device → offer to re-attach
      mediaMissing = true;
      audioName = meta.base.audio.fileName;
    }
  });

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
      >Edit
      <select bind:value={roleId}>
        <option value={BASE}>Base (lyrics)</option>
        {#each roles as r}<option value={r.id}>{r.label}</option>{/each}
      </select>
    </label>
    <button class="btn" onclick={loadRole}>Load</button>
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
    <label class="btn open-lbl" title="Open a project (.band.json) or bundle (.bandpack) as a new project"
      >⤒ Open file<input type="file" accept="application/json,.json,.bandpack" onchange={onOpen} /></label
    >
    <button class="btn" onclick={copyJson}>⧉ Copy JSON</button>
    <button class="btn" onclick={resetProject} title="Discard unsaved edits — reload this project from storage"
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
        <label class="file"
          >load media <input type="file" accept="audio/*,video/*" onchange={onFile} /></label
        >
        {#if mediaMissing}
          <span class="miss" title="Imported without its media — pick the file to attach it on this device"
            >⚠ “{audioName}” isn't on this device — load it to play / sync</span
          >
        {:else if audioName}<span class="hint">{audioName}</span>{/if}
      </div>
      {#if audioUrl}
        {#if mediaIsVideo}
          <!-- svelte-ignore a11y_media_has_caption -->
          <video
            class="vid"
            bind:this={mediaEl}
            src={audioUrl}
            controls
            playsinline
            preload="auto"
            ontimeupdate={() => (curTime = mediaEl ? mediaEl.currentTime : 0)}
            onseeked={() => (curTime = mediaEl ? mediaEl.currentTime : 0)}
            onplay={() => (playing = true)}
            onpause={() => (playing = false)}
            onended={() => (playing = false)}
          ></video>
        {:else}
          <audio
            class="aud"
            bind:this={mediaEl}
            src={audioUrl}
            controls
            preload="auto"
            ontimeupdate={() => (curTime = mediaEl ? mediaEl.currentTime : 0)}
            onseeked={() => (curTime = mediaEl ? mediaEl.currentTime : 0)}
            onplay={() => (playing = true)}
            onpause={() => (playing = false)}
            onended={() => (playing = false)}
          ></audio>
        {/if}
        <div class="row tap-row">
          <button class="btn" onclick={togglePlay}>{playing ? '⏸' : '▶'}</button>
          <b class="clock">{curTime.toFixed(2)}s</b>
          <button class="btn tap" onclick={markStart} title="Mark start of this line (space or S)">S start</button>
          <button class="btn" onclick={markEnd} title="Mark end of this line (E)">E end</button>
          <button class="btn" onclick={next} disabled={cur >= objects.length - 1} title="Next line (N)">N ↓</button>
          <button class="btn" onclick={prev} disabled={cur <= 0} title="Previous line (P)">P ↑</button>
          <button class="btn" onclick={resetTaps} title="Back to the first line">⤒ top</button>
        </div>
        {#if objects.length}
          <p class="hint next">
            Line {cur + 1}/{objects.length}: <span class="nx">{preview(objects[cur])}</span>
            <span class="dim">· space/S start · E end · N next · P prev · or click a line</span>
          </p>
        {/if}
      {:else}
        <p class="hint">Load an audio or video file to tap-to-time, or edit the seconds directly below.</p>
      {/if}

      <div class="tbl">
        {#each objects as o, i (o.id)}
          <div class="trow" class:on={i === activeIdx} class:cur={i === cur}>
            <span class="k {o.type}">{o.type}</span>
            <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
            <span
              class="c"
              role="button"
              tabindex="-1"
              title="Click to make this the current line, then S / E to mark"
              onclick={() => (cur = i)}>{preview(o)}</span
            >
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
  .miss {
    color: #ffcf6b;
    font-size: 0.82rem;
  }
  .vid {
    width: 100%;
    max-height: 360px;
    background: #000;
    border-radius: 8px;
    margin-top: 6px;
  }
  .aud {
    width: 100%;
    margin-top: 6px;
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
  .dim {
    color: #6b7482;
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
  .trow.cur {
    box-shadow: inset 2px 0 0 #4fd1c5;
  }
  .trow.cur .c {
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
    cursor: pointer;
  }
  .c:hover {
    color: #fff;
    text-decoration: underline dotted #4fd1c5;
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
