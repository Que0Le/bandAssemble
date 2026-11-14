<script lang="ts">
  // Maestro-only: the real recording the Maestro watches + plays aloud. The element
  // itself is the authoritative clock and sound source (see lib/audio — attach),
  // and the band follows it. Transport is driven by the TransportBar (so the
  // Maestro stays authoritative), not the element's own controls. For an audio-only
  // project the element is still here (hidden) to be the sound/clock; video shows.
  import { onDestroy, onMount } from 'svelte';
  import { session } from '../session.svelte';
  import { activeId, meta, storeProjectMedia } from '../view.svelte';
  import { getMediaUrl } from '../lib/media';
  const s = session!;

  let mediaEl = $state<HTMLMediaElement | undefined>(undefined);
  let url = $state('');
  let name = $state('');
  let isVideo = $state(false);
  let missing = $state(false); // project names media, but its bytes aren't on this device

  onMount(async () => {
    const got = await getMediaUrl(activeId);
    if (got) {
      url = got.url;
      name = got.meta.name;
      isVideo = got.meta.type.startsWith('video/');
    } else if (meta.base.audio) {
      missing = true;
      name = meta.base.audio.fileName;
    }
  });

  // Attach the live element to the audio engine as the clock + sound. Re-runs when
  // the element (re)mounts, e.g. after loading/replacing the media.
  $effect(() => {
    s.attachMedia(mediaEl);
  });

  async function onFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    if (url) URL.revokeObjectURL(url);
    url = URL.createObjectURL(f);
    name = f.name;
    isVideo = f.type.startsWith('video/');
    missing = false;
    await storeProjectMedia(f);
  }

  onDestroy(() => {
    s.attachMedia(undefined);
    if (url) URL.revokeObjectURL(url);
  });
</script>

<div class="mm" class:audioOnly={!!url && !isVideo}>
  {#if url}
    {#if isVideo}
      <!-- svelte-ignore a11y_media_has_caption -->
      <video class="vid" bind:this={mediaEl} src={url} playsinline preload="auto"></video>
    {:else}
      <!-- audio-only: kept in the DOM to be the sound + clock, no visual player -->
      <audio class="hidden-aud" bind:this={mediaEl} src={url} preload="auto"></audio>
      <span class="label">♪ {name}</span>
    {/if}
  {:else if missing}
    <label class="attach" title="This project names a recording, but its file isn't on this device — pick it to play.">
      ⚠ “{name}” isn't on this device — load it to play
      <input type="file" accept="audio/*,video/*" onchange={onFile} />
    </label>
  {:else}
    <label class="attach">
      ＋ Add the song (audio or video) to play
      <input type="file" accept="audio/*,video/*" onchange={onFile} />
    </label>
  {/if}
</div>

<style>
  .mm {
    flex: none;
    display: flex;
    justify-content: center;
    align-items: center;
    gap: 10px;
  }
  .mm.audioOnly {
    justify-content: flex-start;
  }
  .vid {
    max-height: 30vh;
    max-width: 100%;
    background: #000;
    border: 1px solid #2a3340;
    border-radius: 10px;
  }
  .hidden-aud {
    display: none;
  }
  .label {
    color: #bdf0cf;
    font-size: 0.82rem;
  }
  .attach {
    cursor: pointer;
    color: #cfe8ff;
    background: #182230;
    border: 1px dashed #2f4a5a;
    border-radius: 10px;
    padding: 8px 14px;
    font-size: 0.85rem;
  }
  .attach:hover {
    border-color: #4fd1c5;
  }
  .attach input {
    display: none;
  }
</style>
