<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { objectIndexAt, isComment } from '../lib/model';
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
    setImportSource,
    storeProjectMedia,
    activeId,
  } from '../view.svelte';
  import { getMediaUrl } from '../lib/media';
  import { parseSheet, carryTimes, reTime } from '../lib/parseSheet';
  import { objectsText } from '../lib/serialize';
  import { copyText } from '../lib/clipboard';
  import { r2, secToClock, clockToSec } from '../lib/util';
  import ObjectView from './ObjectView.svelte';
  import TimingChordHelper from './TimingChordHelper.svelte';

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

  // Status toasts — float top-right, overlay without reflow, auto-dismiss after
  // 5s, and close immediately when clicked.
  let toasts = $state<{ id: number; msg: string; kind: 'ok' | 'err' }[]>([]);
  let toastSeq = 0;
  function dismissToast(id: number) {
    toasts = toasts.filter((t) => t.id !== id);
  }
  function note(msg: string) {
    const kind: 'ok' | 'err' = /fail|bad|error|couldn|isn't|⚠|not /i.test(msg) ? 'err' : 'ok';
    const id = ++toastSeq;
    toasts = [...toasts, { id, msg, kind }];
    setTimeout(() => dismissToast(id), 5000);
  }

  const activeIdx = $derived(objectIndexAt(objects, curTime));

  // Explicit re-parse: resets timing to a sequential placeholder (use after a
  // structural text change, then re-tap). Loading a target preserves its times.
  // Parse the sheet box. If it holds JSON (a copied chart — array of objects, or
  // {objects} / {title,roleId,objects}), load it verbatim so all timestamps are
  // kept; otherwise parse the text markup (which carries no times → placeholders).
  // JSON chart draft ({…} or an array of objects) vs. text markup, which can
  // legitimately start with a [Section] label — so only `{` or `[{`/`["` is JSON.
  const looksLikeJson = (trimmed: string) => trimmed.startsWith('{') || /^\[\s*[{"]/.test(trimmed);

  function parse() {
    const trimmed = sheet.trim();
    if (looksLikeJson(trimmed)) {
      try {
        loadJson(trimmed);
      } catch (e) {
        note('bad JSON: ' + (e as Error).message);
      }
      return;
    }
    objects = carryTimes(parseSheet(sheet), objects); // keep existing timings by content
    explicitEnd = new Set();
    note('parsed ' + objects.length + ' objects · times kept');
  }

  // Live re-parse: a short debounce after you stop typing reflects sheet edits in
  // the Preview/table without clicking Parse. Times are carried by content, so
  // nothing you've timed is lost. JSON drafts wait for the explicit button (they'd
  // otherwise rewrite the box mid-edit).
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  function scheduleLive() {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      if (looksLikeJson(sheet.trim())) return;
      objects = carryTimes(parseSheet(sheet), objects);
    }, 500);
  }

  // A timestamp field: prefer the human "startMin"/"endMin" clock ("1:42") when
  // present — that's the one you hand-annotate off a player — else the raw seconds.
  function pickSec(clock: unknown, sec: unknown): number {
    if (typeof clock === 'string' && clock.trim()) {
      const c = clockToSec(clock);
      if (Number.isFinite(c)) return r2(c);
    }
    return Number(sec) || 0;
  }

  // Coerce a copied chart JSON into objects (fresh ids, times preserved). Accepts
  // either startSec/endSec (numbers) or startMin/endMin ("m:ss"/"m.ss" strings).
  function objectsFromJson(text: string): SongObject[] {
    const data: unknown = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (data as { objects?: unknown }).objects;
    if (!Array.isArray(arr)) throw new Error('expected an array of chart objects');
    return (arr as Record<string, unknown>[]).map((o, i) => {
      const base = {
        id: 'j' + i,
        startSec: pickSec(o.startMin, o.startSec),
        endSec: pickSec(o.endMin, o.endSec),
        ...(o.ext && typeof o.ext === 'object' ? { ext: o.ext as Record<string, unknown> } : {}),
      };
      if (o.type === 'label') return { ...base, type: 'label', text: String(o.text ?? '') } as SongObject;
      if (o.type === 'tab')
        return {
          ...base,
          type: 'tab',
          lines: Array.isArray(o.lines) ? (o.lines as unknown[]).map(String) : [],
          ...(o.caption ? { caption: String(o.caption) } : {}),
        } as SongObject;
      if (o.type === 'chorddef')
        return { ...base, type: 'chorddef', name: String(o.name ?? ''), grip: String(o.grip ?? '') } as SongObject;
      return {
        ...base,
        type: 'line',
        ...(o.kind ? { kind: String(o.kind) } : {}),
        ...(o.text != null ? { text: String(o.text) } : {}),
        ...(o.strum != null ? { strum: String(o.strum) } : {}),
        ...(o.note != null ? { note: String(o.note) } : {}),
      } as SongObject;
    });
  }
  // Load objects from a JSON string (times kept) and normalize the box to markup.
  function loadJson(text: string) {
    const objs = objectsFromJson(text);
    if (!objs.length) throw new Error('no objects');
    objects = objs;
    sheet = objectsText(objs);
    cur = 0;
    explicitEnd = new Set();
    note('loaded ' + objs.length + ' objects from JSON · times kept');
  }
  // Read the clipboard and load it as chart JSON.
  async function pasteJson() {
    try {
      loadJson(await navigator.clipboard.readText());
    } catch (e) {
      note('paste the JSON into the box and Parse (' + (e as Error).message + ')');
    }
  }
  // The helper hands us a generated chart JSON; load it through the normal JSON
  // path (parse() detects JSON → keeps all timestamps, normalizes the box to
  // markup). We don't auto-wire its output into the Sheet — only this button does.
  function useFromHelper(chartJson: string, source: { chords: string; lrc: string }) {
    let rid = 'guitar';
    let songTitle = '';
    try {
      const d = JSON.parse(chartJson) as { roleId?: string; title?: string };
      rid = d.roleId || 'guitar';
      songTitle = d.title || '';
    } catch {
      /* keep defaults */
    }
    sheet = chartJson;
    parse(); // loads objects (timestamps kept)
    // Commit to a real Role. A fresh project edits the Base, which isn't a
    // performable chart — without this, maestro/player open with no role/chart.
    if (!roles.some((r) => r.id === rid)) roles.push({ id: rid, kind: 'guitar', label: 'Guitar' });
    roleId = rid; // edit the imported role, not the Base
    const end = objects.reduce((m, o) => Math.max(m, o.endSec || 0), 0);
    if (end > meta.base.lengthSec) meta.base.lengthSec = end; // span the transport
    if (songTitle && (!meta.title || meta.title === 'Untitled')) {
      meta.title = songTitle;
      title = songTitle;
    }
    setChart(rid, objects); // create the Role (if new) + store the chart + persist
    setImportSource(source); // remember the original paste
    note(`imported to “${rid}” · saved to project`);
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
    await storeProjectMedia(f); // store in IndexedDB + note length + keep from eviction
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

  // Offset the whole chart's timing (the Sheet's offset) — live in the Timing
  // panel. Unlike the helper's alignment, this shifts the actual objects' times.
  let nudgeStep = $state<number | null>(0.1);
  const stepNum = $derived(typeof nudgeStep === 'number' && isFinite(nudgeStep) ? nudgeStep : 0.1);
  function shiftAll(d: number) {
    if (!objects.length || !d) return;
    for (const o of objects) {
      o.startSec = r2(Math.max(0, o.startSec + d));
      o.endSec = r2(Math.max(0, o.endSec + d));
    }
    objects = objects; // nudge reactivity
  }
  // Raw chart JSON for the collapsible viewer below the helper.
  const rawJson = $derived(JSON.stringify({ title, roleId, objects }, null, 2));

  // Lyric line height in the Preview — defaults to 3 (2× the base 1.5) and is
  // adjustable via the slider; applied as a CSS var so only the Preview changes.
  let lineH = $state(3);

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
  // N / P — move the current line; no stamping. Skip comment blocks: they're
  // annotations, not timed lines.
  function next() {
    for (let i = cur + 1; i < objects.length; i++) {
      if (!isComment(objects[i])) {
        cur = i;
        return;
      }
    }
  }
  function prev() {
    for (let i = cur - 1; i >= 0; i--) {
      if (!isComment(objects[i])) {
        cur = i;
        return;
      }
    }
  }
  function resetTaps() {
    const first = objects.findIndex((o) => !isComment(o));
    cur = first < 0 ? 0 : first;
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

  // Each tab block's 1-based ordinal among tab blocks, so a captionless tab can
  // show "line 1", "line 2", … in the timing list.
  const tabNo = $derived.by(() => {
    const m = new Map<string, number>();
    let n = 0;
    for (const o of objects) if (o.type === 'tab') m.set(o.id, ++n);
    return m;
  });

  function preview(o: SongObject): string {
    if (o.type === 'label') return '[' + o.text + ']';
    if (o.type === 'chorddef') return o.name + ' [' + o.grip + ']';
    if (o.type === 'tab') {
      const cap = o.caption?.trim();
      if (cap) return cap.length > 30 ? cap.slice(0, 30) + '...' : cap;
      return 'line ' + (tabNo.get(o.id) ?? '?');
    }
    const kind = o.kind && o.kind !== 'lyric' ? '@' + o.kind + ' ' : '';
    return kind + (o.text || o.strum || (o.note ? '(' + o.note + ')' : '(empty)'));
  }

  async function copySheet() {
    const ok = await copyText(`${title}\n\n${objectsText(objects)}`);
    note(ok ? 'sheet copied' : 'copy failed');
  }
  async function copyJson() {
    // Emit both forms: startSec/endSec (numbers) for the app, and startMin/endMin
    // ("m:ss" strings) to hand-annotate off a player's elapsed time.
    const out = objects.map((o) => ({
      ...o,
      startMin: secToClock(o.startSec),
      endMin: secToClock(o.endSec),
    }));
    const ok = await copyText(JSON.stringify({ title, roleId, objects: out }, null, 2));
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
  </div>

  <!-- Status toasts: float over the top-right corner, overlay without reflow, and
       close on click. The container ignores pointer events so it never blocks the
       view; only the toasts themselves are clickable. -->
  <div class="toasts" aria-live="polite">
    {#each toasts as t (t.id)}
      <button
        class="toast {t.kind}"
        transition:fly={{ x: 40, duration: 220 }}
        onclick={() => dismissToast(t.id)}
        title="dismiss"
      >
        {t.msg}
      </button>
    {/each}
  </div>

  <!-- Import helper (full width): Chords | LRC, then Combined + action buttons. -->
  <TimingChordHelper onUse={useFromHelper} initial={meta.base.import} />

  <!-- Raw chart JSON, collapsible. -->
  <details class="rawjson">
    <summary>🧾 Raw chart JSON</summary>
    <pre class="rawout">{rawJson}</pre>
  </details>

  <!-- Sheet | Preview, above the timing area. -->
  <div class="ed-row">
    <div class="panel sheet-col">
      <h2>Sheet (paste or type)</h2>
      <textarea
        class="sheet"
        bind:value={sheet}
        oninput={scheduleLive}
        spellcheck="false"
        placeholder={'[Verse]\n[G]Lyrics with inline [C]chords\n↓ ↓↑ ↓↑\n(a note)'}
      ></textarea>
      <div class="row">
        <button class="btn" onclick={parse}>Parse → objects</button>
        <button class="btn" onclick={pasteJson} title="Paste a copied chart JSON from the clipboard — keeps every timestamp">⧉ Paste JSON</button>
        <span class="hint">Chords inline as [G]. Sections [Verse]. Strum ↓↑×. Notes (…). @solo/@instrumental for parts. <b>Am7 [x02010]</b> defines a fingering. Paste JSON here (then Parse) to keep times — <b>startMin</b>/<b>endMin</b> like "1:42" or raw startSec.</span>
      </div>
    </div>

    <div class="panel prev-col">
      <h2>Preview</h2>
      <label class="lh-ctl"
        >line height
        <input type="range" min="1.2" max="5" step="0.1" bind:value={lineH} aria-label="lyric line height" />
        <span class="lh-val">{lineH.toFixed(1)}×</span>
      </label>
      <div class="prev" style="--lyric-lh: {lineH}">
        {#each objects as o, i (o.id)}
          <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
          <div
            class="pobj"
            class:on={i === activeIdx}
            role="button"
            tabindex="-1"
            title="Double-click to jump the video here"
            ondblclick={() => seekTo(o.startSec)}
          >
            <ObjectView obj={o} />
          </div>
        {/each}
      </div>
    </div>
  </div>

  <!-- Timing: one column. The video + controls stay sticky at the top while the
       lines scroll past them. -->
  <div class="panel timing-col">
    <h2>Timing</h2>
    <div class="timing-head">
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
        <p class="hint">Load the video to tap-to-time, or edit the seconds directly in the table below.</p>
      {/if}
      {#if objects.length}
        <div class="row off-row">
          <span class="off">Offset</span>
          <button class="btn step" onclick={() => shiftAll(-stepNum)} title="shift all lines earlier" aria-label="shift earlier">&lt;</button>
          <input class="offnum" type="number" step="0.1" bind:value={nudgeStep} aria-label="nudge step in seconds" />
          <button class="btn step" onclick={() => shiftAll(stepNum)} title="shift all lines later" aria-label="shift later">&gt;</button>
          <span class="offunit">s</span>
          <span class="hint">nudge every line's time earlier/later to lock the chart to the video</span>
        </div>
      {/if}
    </div>
    <div class="tbl">
      {#each objects as o, i (o.id)}
        <div class="trow" class:on={i === activeIdx} class:cur={i === cur} class:comment={isComment(o)}>
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
</section>

<style>
  .editor {
    max-width: 1500px;
    margin: 0 auto;
    padding: 16px;
    overflow: visible; /* the window scrolls, not this section (see below) */
  }
  /* Full-width panels (Sheet, Preview) between the rows get the row gap too. */
  .editor > .panel {
    margin-bottom: 16px;
  }
  /* Use the browser's own scrollbar here, not the fixed app-shell inner scroll:
     let the shell grow with the content so the whole window scrolls instead. */
  :global(html:has(.editor)),
  :global(body:has(.editor)) {
    height: auto;
    min-height: 100%;
    overflow: visible;
  }
  :global(#app:has(.editor)) {
    height: auto;
    min-height: 100dvh;
    overflow: visible;
  }
  /* Raw chart JSON viewer (collapsible). */
  .rawjson {
    background: var(--panel);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 0 14px;
    margin-bottom: 16px;
  }
  .rawjson summary {
    cursor: pointer;
    padding: 12px 2px;
    color: var(--muted);
    font-weight: 600;
    user-select: none;
  }
  .rawout {
    margin: 0 0 14px;
    max-height: 320px;
    overflow: auto;
    background: #0b0f16;
    border: 1px solid #1c232e;
    border-radius: 8px;
    padding: 10px 12px;
    font: 0.72rem/1.45 var(--mono);
    white-space: pre;
    color: #cfd7e2;
  }
  /* Timing is one column: the video + controls stick to the top while the lines
     scroll past them. */
  .timing-head {
    flex: 0 0 auto;
    background: var(--panel);
    padding-bottom: 8px;
    margin-bottom: 4px;
    box-shadow: 0 8px 10px -8px rgba(0, 0, 0, 0.6);
  }
  .off-row {
    align-items: center;
  }
  .off {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: #8b93a3;
  }
  .offnum {
    width: 58px;
    background: #0f1218;
    color: #e6edf3;
    border: 1px solid #2a3340;
    border-radius: 7px;
    padding: 4px 6px;
    font: 0.85rem var(--mono);
    text-align: center;
  }
  .btn.step {
    padding: 4px 10px;
    font-weight: 700;
  }
  .offunit {
    font-family: var(--mono);
    color: #8b93a3;
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
  /* Toasts float over the top-right corner. The container never blocks clicks;
     each toast does (so it can be clicked to dismiss). */
  .toasts {
    position: fixed;
    top: 14px;
    right: 14px;
    z-index: 50;
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: flex-end;
    pointer-events: none;
  }
  .toast {
    pointer-events: auto;
    cursor: pointer;
    text-align: left;
    min-width: 190px;
    max-width: 340px;
    border: 1px solid #2f6b45;
    border-left-width: 3px;
    border-radius: 8px;
    background: #10251a;
    color: #bdf0cf;
    padding: 9px 12px;
    font-size: 0.85rem;
    font-family: inherit;
    box-shadow: 0 6px 18px rgba(0, 0, 0, 0.45);
  }
  .toast.err {
    border-color: #7a2d2d;
    background: #2a1414;
    color: #f5c0c0;
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
  /* Each working section is a 2-column row: Timing | Video, then Sheet | Preview
     (the helper above lays out its own Chords | LRC and Combined | Output rows). */
  /* Sheet + Preview share one clear container (a bordered box). On wide screens
     it has a fixed height, and the Timing panel below is set to the same height. */
  .ed-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
    margin-bottom: 16px;
    align-items: stretch;
    border: 1px solid var(--line);
    background: #0d1218;
    border-radius: 14px;
    padding: 12px;
    overflow: hidden;
    resize: vertical; /* drag the bottom edge to resize the whole container */
  }
  /* Inside the container the two panels are flush columns, not nested cards; each
     scrolls on its own if its (resizable) content outgrows the container. */
  .ed-row > .panel {
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    overflow: auto;
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 0;
  }
  /* Timing matches the container's height: the video + controls are a fixed head,
     and only the table scrolls below them, so lines never slide under the video. */
  .timing-col {
    display: flex;
    flex-direction: column;
    overflow: hidden;
    resize: vertical; /* drag the bottom edge to give the lines more room */
  }
  @media (min-width: 901px) {
    .ed-row {
      height: 624px;
    }
    .timing-col {
      /* Tall enough for ~12 line rows (31px each) beneath the video + controls. */
      height: 820px;
    }
  }
  @media (max-width: 900px) {
    .ed-row {
      grid-template-columns: 1fr;
    }
  }
  .sheet {
    width: 100%;
    flex: 1 1 auto;
    min-height: 260px;
    resize: none;
    font-family: var(--mono);
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
    max-height: 190px;
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
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
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
  /* Comment blocks: not part of the timing — dim the line and mute its values
     (kept, not discarded, so a line can be commented out without losing time). */
  .trow.comment .c {
    color: #6b7482;
    font-style: italic;
  }
  .trow.comment .k,
  .trow.comment .t {
    opacity: 0.5;
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
    flex: 1 1 auto;
    min-height: 0;
    overflow: auto;
    padding: 4px 6px;
  }
  /* Preview line-height control. */
  .lh-ctl {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.78rem;
    color: var(--muted);
    margin: 0 0 8px;
    flex: 0 0 auto;
  }
  .lh-ctl input[type='range'] {
    width: 130px;
  }
  .lh-val {
    font-variant-numeric: tabular-nums;
    color: #cdd6e2;
  }
  .pobj {
    padding: 5px 8px;
    border-radius: 6px;
    opacity: 0.6;
    cursor: pointer;
  }
  .pobj.on {
    opacity: 1;
    background: #161f2a;
  }
  /* Phone: stack to one column and let the page scroll — drop the inner scroll
     boxes so there's no box-inside-a-scrolling-page double scroll. */
  @media (max-width: 640px) {
    .sheet {
      min-height: 220px;
    }
  }
</style>
