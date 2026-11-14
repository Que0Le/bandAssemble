<script lang="ts">
  // Landing page: the list of locally-stored projects. Create a blank one, import
  // a .band.json (added as a NEW project, never clobbering), open / rename /
  // duplicate / export / delete. Everything lives on this device (localStorage for
  // text, IndexedDB for media); a storage meter shows how much room is left.
  import { onMount, onDestroy } from 'svelte';
  import { Lobby } from '../lib/lobby.svelte';
  import {
    listProjects,
    duplicateProject,
    deleteProject,
    renameProject,
    exportProjectFile,
    exportBundle,
    importProjectFromText,
    importBundle,
    looksLikeBundle,
    type ProjectMeta,
  } from '../lib/projects';
  import { storageEstimate, requestPersist, hasMedia } from '../lib/media';
  import { mmss } from '../lib/util';

  let projects = $state<ProjectMeta[]>(listProjects());
  function refresh() {
    projects = listProjects();
    void refreshMedia();
  }

  // Which projects actually have their media blob on THIS device. A project that
  // names an audio file but isn't in this set was imported/duplicated text-only —
  // the media must be re-attached here (in the Editor) before it can play.
  let mediaIds = $state<Set<string>>(new Set());
  async function refreshMedia() {
    const ids = await Promise.all(projects.map(async (p) => ((await hasMedia(p.id)) ? p.id : '')));
    mediaIds = new Set(ids.filter(Boolean));
  }
  const mediaMissing = (p: ProjectMeta) => !!p.audioName && !mediaIds.has(p.id);

  // open a project → the seat chooser (?project=<id>, no seat yet)
  function open(id: string) {
    const sp = new URLSearchParams();
    sp.set('project', id);
    location.search = sp.toString();
  }

  // --- live sessions on the network (discovery) ---
  // Listen on the lobby for Maestros advertising a live session; show them so a
  // device with only the sample project can still jump into the band's song.
  const lobby = new Lobby(Math.random().toString(36).slice(2, 8));
  const liveSessions = $derived(Object.values(lobby.hosts).sort((a, b) => b.seenAt - a.seenAt));
  function join(code: string) {
    const sp = new URLSearchParams();
    sp.set('session', code);
    sp.set('seat', 'player'); // straight into the Player seat; charts stream from the host
    location.search = sp.toString();
  }
  onDestroy(() => lobby.close());

  // --- import ---
  let msg = $state('');
  let flash: ReturnType<typeof setTimeout> | undefined;
  function note(m: string) {
    msg = m;
    clearTimeout(flash);
    flash = setTimeout(() => (msg = ''), 2600);
  }
  async function onImport(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    try {
      const text = await f.text();
      const id = looksLikeBundle(text) ? await importBundle(text) : importProjectFromText(text);
      open(id);
    } catch (err) {
      note((err as Error).message);
      input.value = '';
    }
  }

  // --- per-card actions ---
  let renamingId = $state<string | null>(null);
  let renameText = $state('');
  function startRename(p: ProjectMeta) {
    renamingId = p.id;
    renameText = p.title;
  }
  function commitRename() {
    if (renamingId) {
      renameProject(renamingId, renameText);
      renamingId = null;
      refresh();
    }
  }
  function dup(id: string) {
    duplicateProject(id);
    refresh();
  }
  async function del(p: ProjectMeta) {
    const ok = confirm(
      `Delete "${p.title}"?\n\nThis removes its charts and any stored audio from this device. This cannot be undone.`,
    );
    if (!ok) return;
    await deleteProject(p.id);
    refresh();
  }

  // --- storage meter ---
  let est = $state<{ usage: number; quota: number } | null>(null);
  let persisted = $state<boolean | null>(null);
  onMount(async () => {
    est = await storageEstimate();
    try {
      persisted = (await navigator.storage?.persisted?.()) ?? null;
    } catch {
      persisted = null;
    }
    await refreshMedia();
    lobby.connect(); // observe only — the Home page never hosts
  });
  async function keepStorage() {
    persisted = await requestPersist();
    note(persisted ? 'Storage will be kept' : 'Browser declined persistent storage');
  }

  const mb = (n: number) => (n >= 1024 * 1024 * 1024 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB');
  function when(ts: number) {
    const d = Date.now() - ts;
    if (d < 60000) return 'just now';
    if (d < 3600000) return Math.round(d / 60000) + 'm ago';
    if (d < 86400000) return Math.round(d / 3600000) + 'h ago';
    return new Date(ts).toLocaleDateString();
  }
</script>

<section class="home">
  <div class="head">
    <h1>Projects</h1>
    <div class="grow"></div>
    {#if est}
      <span class="meter" title="Local storage used on this device">
        {mb(est.usage)} used{#if est.quota} · {mb(Math.max(0, est.quota - est.usage))} free{/if}
      </span>
      {#if persisted === false}
        <button class="btn" onclick={keepStorage} title="Ask the browser not to evict your projects"
          >Keep storage</button
        >
      {/if}
    {/if}
    <label class="btn import" title="Import a .band.json project or a .bandpack bundle (added as a new project)">
      ⤒ Import file<input type="file" accept="application/json,.json,.bandpack" onchange={onImport} />
    </label>
    <a class="btn primary" href="?new=1">＋ New project</a>
  </div>

  {#if msg}<p class="msg">{msg}</p>{/if}

  {#if liveSessions.length}
    <div class="live">
      <h2>On the network</h2>
      <ul class="live-list">
        {#each liveSessions as h (h.device)}
          <li class="live-card">
            <span class="dot" aria-hidden="true"></span>
            <div class="live-main">
              <span class="live-ttl">{h.title}</span>
              <span class="live-sub">live session · code {h.code}</span>
            </div>
            <button class="btn primary" onclick={() => join(h.code)}>Join</button>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  {#if projects.length === 0}
    <div class="empty">No projects yet. Create one above, or import a file.</div>
  {:else}
    <ul class="list">
      {#each projects as p (p.id)}
        <li class="card">
          <div class="main" onclick={() => renamingId !== p.id && open(p.id)} role="button" tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && renamingId !== p.id && open(p.id)}>
            {#if renamingId === p.id}
              <!-- svelte-ignore a11y_autofocus -->
              <input
                class="rename-in"
                bind:value={renameText}
                autofocus
                onclick={(e) => e.stopPropagation()}
                onkeydown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  else if (e.key === 'Escape') renamingId = null;
                }}
                onblur={commitRename}
              />
            {:else}
              <span class="ttl">{p.title}</span>
            {/if}
            <span class="sub">
              {when(p.updatedAt)}
              {#if p.lengthSec}· ⏱ {mmss(p.lengthSec)}{/if}
              {#if p.audioName}· 🎵 {p.audioName}{/if}
              {#if mediaMissing(p)}<span class="warn" title="The audio isn't stored on this device — open the project and re-attach it (⤒ load media) to play.">· ⚠ media not on this device</span>{/if}
            </span>
          </div>
          <div class="acts">
            <button class="ic" title="Open" onclick={() => open(p.id)}>Open</button>
            <button class="ic" title="Rename" onclick={() => startRename(p)}>✎</button>
            <button class="ic" title="Duplicate" onclick={() => dup(p.id)}>⎘</button>
            <button class="ic" title="Export project only (.band.json)" onclick={() => exportProjectFile(p.id)}>⤓</button>
            {#if mediaIds.has(p.id)}
              <button class="ic" title="Export with media (.bandpack) — for moving to another device" onclick={() => exportBundle(p.id)}>⇪</button>
            {/if}
            <button class="ic danger" title="Delete" onclick={() => del(p)}>✕</button>
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .home {
    max-width: 760px;
    margin: 0 auto;
    padding: 8px 16px 40px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 14px;
  }
  .head h1 {
    margin: 0;
    font-size: 1.4rem;
  }
  .grow {
    flex: 1;
  }
  .meter {
    color: #8b93a3;
    font-size: 0.78rem;
  }
  .rename-in {
    width: 100%;
    font-weight: 650;
    background: #0f1218;
    color: #e6edf3;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 8px 12px;
    font-size: 0.95rem;
  }
  .msg {
    color: #ffcf6b;
    font-size: 0.82rem;
    margin: 4px 0;
  }
  .empty {
    border: 1px dashed #2a3340;
    border-radius: 10px;
    padding: 28px;
    text-align: center;
    color: #8b93a3;
  }
  .live {
    margin-bottom: 18px;
  }
  .live h2 {
    font-size: 0.85rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #8b93a3;
    margin: 0 0 8px;
  }
  .live-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .live-card {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid #2f6b45;
    border-radius: 10px;
    background: #10211a;
    padding: 10px 12px;
  }
  .dot {
    flex: none;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #48bb78;
    box-shadow: 0 0 0 0 rgba(72, 187, 120, 0.6);
    animation: pulse 1.8s infinite;
  }
  @keyframes pulse {
    70% {
      box-shadow: 0 0 0 7px rgba(72, 187, 120, 0);
    }
    100% {
      box-shadow: 0 0 0 0 rgba(72, 187, 120, 0);
    }
  }
  .live-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .live-ttl {
    font-weight: 650;
    color: #e6edf3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .live-sub {
    color: #8b93a3;
    font-size: 0.76rem;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .card {
    display: flex;
    align-items: center;
    gap: 10px;
    border: 1px solid #222a33;
    border-radius: 10px;
    background: #0f1218;
    padding: 10px 12px;
  }
  .card:hover {
    border-color: #2f4a5a;
  }
  .main {
    flex: 1;
    min-width: 0;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .ttl {
    font-weight: 650;
    color: #e6edf3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sub {
    color: #8b93a3;
    font-size: 0.76rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .warn {
    color: #ffcf6b;
  }
  .acts {
    display: flex;
    gap: 4px;
    flex: none;
  }
  .btn {
    cursor: pointer;
    color: #cfe8ff;
    background: #182230;
    border: 1px solid #2a3b4e;
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 0.82rem;
  }
  .btn:hover {
    border-color: #4fd1c5;
  }
  .btn:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .btn.primary {
    background: #1b3326;
    border-color: #2f6b45;
    color: #bdf0cf;
  }
  .btn.import {
    position: relative;
    overflow: hidden;
  }
  .btn.import input {
    display: none;
  }
  .ic {
    cursor: pointer;
    color: #9aa6b2;
    background: transparent;
    border: 1px solid #2a3340;
    border-radius: 7px;
    padding: 6px 9px;
    font-size: 0.8rem;
  }
  .ic:hover {
    border-color: #4fd1c5;
    color: #e6edf3;
  }
  .ic.danger:hover {
    border-color: #c5534f;
    color: #ffb4b0;
  }
</style>
