<script lang="ts">
  // New-project wizard: Name -> Media -> Lyrics. Creates the project locally, stores
  // the audio/video blob in IndexedDB, parses the pasted lyrics into the Base skeleton
  // (sequential placeholder times), then hands off to the Editor to sync (tap-to-time).
  // Media is optional here — it can be attached later — and only the Maestro needs it.
  import { onDestroy } from 'svelte';
  import { createProject, loadProject, saveProject, setLastOpened } from '../lib/projects';
  import { putMedia, requestPersist } from '../lib/media';
  import { parseSheet, autoTime } from '../lib/parseSheet';

  let step = $state(1);
  const home = () => location.pathname;

  // step 1
  let title = $state('');

  // step 2 — media (held in memory until Finish, then written to IDB)
  let mediaFile = $state<File | null>(null);
  let mediaUrl = $state('');
  let mediaIsVideo = $state(false);
  let durationSec = $state(0);
  function onMedia(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaFile = f;
    mediaUrl = URL.createObjectURL(f);
    mediaIsVideo = f.type.startsWith('video/');
    durationSec = 0;
  }
  function clearMedia() {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
    mediaFile = null;
    mediaUrl = '';
    durationSec = 0;
  }

  // step 3
  let lyrics = $state('');

  let busy = $state(false);
  let err = $state('');

  const canFinish = $derived(title.trim().length > 0);

  async function finish() {
    if (!canFinish || busy) return;
    busy = true;
    err = '';
    try {
      const id = createProject(title);
      const p = loadProject(id)!;
      const objs = autoTime(parseSheet(lyrics));
      p.base.lyrics = objs;
      // length: real media duration if known, else the end of the last parsed line
      const lastEnd = objs.length ? objs[objs.length - 1].endSec : 0;
      p.base.lengthSec = Math.round((durationSec || lastEnd) * 100) / 100;
      if (mediaFile) p.base.audio = { fileName: mediaFile.name, durationSec: p.base.lengthSec };
      saveProject(p);
      if (mediaFile) {
        await putMedia(id, mediaFile);
        void requestPersist(); // keep the stored media from being evicted
      }
      setLastOpened(id);
      // hand off to the Editor to sync
      location.search = `?seat=editor&project=${encodeURIComponent(id)}`;
    } catch (e) {
      err = (e as Error).message;
      busy = false;
    }
  }

  function fmt(s: number) {
    if (!s) return '';
    const m = Math.floor(s / 60);
    const ss = Math.round(s % 60)
      .toString()
      .padStart(2, '0');
    return `${m}:${ss}`;
  }

  onDestroy(() => {
    if (mediaUrl) URL.revokeObjectURL(mediaUrl);
  });
</script>

<section class="wiz">
  <div class="top">
    <a class="back" href={home()}>← Cancel</a>
    <ol class="steps">
      <li class:on={step === 1} class:done={step > 1}>Name</li>
      <li class:on={step === 2} class:done={step > 2}>Media</li>
      <li class:on={step === 3}>Lyrics</li>
    </ol>
  </div>

  {#if step === 1}
    <div class="panel">
      <h2>Name your project</h2>
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="in big"
        placeholder="Song title…"
        bind:value={title}
        autofocus
        onkeydown={(e) => e.key === 'Enter' && title.trim() && (step = 2)}
      />
      <p class="hint">You can rename it any time from the projects list.</p>
    </div>
  {:else if step === 2}
    <div class="panel">
      <h2>Add the audio or video</h2>
      <p class="hint">
        The Maestro plays this; players follow the clock. A video is handy while you
        sync the lyrics. It's stored on this device only — you can add or replace it later.
      </p>
      {#if !mediaFile}
        <label class="drop">
          <span>🎵 Choose an audio or video file</span>
          <input type="file" accept="audio/*,video/*" onchange={onMedia} />
        </label>
      {:else}
        <div class="media">
          {#if mediaIsVideo}
            <!-- svelte-ignore a11y_media_has_caption -->
            <video
              class="player"
              src={mediaUrl}
              controls
              onloadedmetadata={(e) => (durationSec = (e.currentTarget as HTMLVideoElement).duration)}
            ></video>
          {:else}
            <audio
              class="player"
              src={mediaUrl}
              controls
              onloadedmetadata={(e) => (durationSec = (e.currentTarget as HTMLAudioElement).duration)}
            ></audio>
          {/if}
          <div class="mrow">
            <span class="mname">{mediaFile.name}{#if durationSec} · {fmt(durationSec)}{/if}</span>
            <button class="btn ghost" onclick={clearMedia}>Remove</button>
          </div>
        </div>
      {/if}
    </div>
  {:else}
    <div class="panel">
      <h2>Paste the lyrics</h2>
      <p class="hint">
        One line per lyric line. Mark sections like <code>[Verse]</code> or
        <code>[Chorus]</code>. You'll time them to the music in the next step.
      </p>
      <textarea
        class="sheet"
        bind:value={lyrics}
        spellcheck="false"
        placeholder={'[Verse 1]\nFirst line of the verse\nSecond line\n\n[Chorus]\nThe hook goes here'}
      ></textarea>
    </div>
  {/if}

  {#if err}<p class="err">{err}</p>{/if}

  <div class="nav">
    {#if step > 1}
      <button class="btn ghost" onclick={() => (step -= 1)} disabled={busy}>← Back</button>
    {/if}
    <span class="grow"></span>
    {#if step < 3}
      <button class="btn primary" onclick={() => (step += 1)} disabled={step === 1 && !title.trim()}>
        Next →
      </button>
    {:else}
      <button class="btn primary" onclick={finish} disabled={!canFinish || busy}>
        {busy ? 'Creating…' : 'Create & sync →'}
      </button>
    {/if}
  </div>
</section>

<style>
  .wiz {
    max-width: 640px;
    margin: 0 auto;
    padding: 8px 16px 40px;
  }
  .top {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-bottom: 18px;
  }
  .back {
    color: var(--muted, #8b93a3);
    font-size: 0.85rem;
    text-decoration: none;
  }
  .back:hover {
    color: var(--accent, #4fd1c5);
  }
  .steps {
    display: flex;
    gap: 8px;
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 0.78rem;
  }
  .steps li {
    color: #6b7482;
    padding: 3px 10px;
    border: 1px solid #222a33;
    border-radius: 999px;
  }
  .steps li.on {
    color: #bdf0cf;
    border-color: #2f6b45;
    background: #16271f;
  }
  .steps li.done {
    color: #8b93a3;
    border-color: #2a3340;
  }
  .panel {
    min-height: 240px;
  }
  .panel h2 {
    margin: 0 0 6px;
    font-size: 1.15rem;
  }
  .hint {
    color: #8b93a3;
    font-size: 0.85rem;
    margin: 0 0 14px;
    line-height: 1.5;
  }
  .hint code {
    background: #0b0e13;
    border: 1px solid #222a33;
    border-radius: 5px;
    padding: 1px 5px;
  }
  .in {
    width: 100%;
    background: #0f1218;
    color: #e6edf3;
    border: 1px solid #2a3340;
    border-radius: 10px;
    padding: 10px 14px;
  }
  .in.big {
    font-size: 1.15rem;
    font-weight: 600;
  }
  .drop {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 150px;
    border: 1px dashed #2f4a5a;
    border-radius: 12px;
    color: #cfe8ff;
    cursor: pointer;
    background: #0d141b;
  }
  .drop:hover {
    border-color: #4fd1c5;
  }
  .drop input {
    display: none;
  }
  .player {
    width: 100%;
    border-radius: 10px;
    background: #000;
  }
  audio.player {
    height: 44px;
  }
  video.player {
    max-height: 300px;
  }
  .mrow {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
  }
  .mname {
    color: #cfd6e2;
    font-size: 0.85rem;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .sheet {
    width: 100%;
    height: 240px;
    resize: vertical;
    font-family: ui-monospace, 'Cascadia Code', Consolas, monospace;
    font-size: 0.95rem;
    line-height: 1.5;
    color: #e8edf5;
    background: #0f1218;
    border: 1px solid #2a3340;
    border-radius: 10px;
    padding: 10px 12px;
  }
  .err {
    color: #ffb4b0;
    font-size: 0.85rem;
  }
  .nav {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 18px;
  }
  .grow {
    flex: 1;
  }
  .btn {
    cursor: pointer;
    color: #cfe8ff;
    background: #182230;
    border: 1px solid #2a3b4e;
    border-radius: 8px;
    padding: 9px 18px;
    font-size: 0.9rem;
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
  .btn.ghost {
    background: transparent;
  }
</style>
