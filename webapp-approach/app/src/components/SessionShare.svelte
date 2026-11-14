<script lang="ts">
  // In-session "Invite" button for the top banner: shows the join link + QR so
  // other devices can jump into THIS room. The link carries the live session id
  // (session.sessionId — the room this device is actually in), not a fresh code,
  // so what you share always matches where you are. Reuses lib/join.
  import { joinUrl, qrSvg, isLoopbackHost } from '../lib/join';
  import { session } from '../session.svelte';

  const sid = session!.sessionId;
  const link = joinUrl(sid); // ?session=<sid>&seat=player
  const qr = qrSvg(link);
  const loopback = isLoopbackHost();

  let open = $state(false);
  let urlEl = $state<HTMLInputElement>();
  let copied = $state(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link); // https / localhost only
    } catch {
      // Plain http on a LAN IP isn't a "secure context", so the async clipboard
      // API is missing — fall back to select + execCommand('copy').
      try {
        urlEl?.focus();
        urlEl?.select();
        urlEl?.setSelectionRange(0, link.length);
        document.execCommand('copy');
      } catch {
        /* field stays selected for a manual Ctrl+C */
      }
    }
    copied = true;
    setTimeout(() => (copied = false), 3000);
  }
</script>

<div class="share">
  <button
    class="share-btn"
    class:open
    onclick={() => (open = !open)}
    title="Show the link + QR so others can join this session"
  >
    🔗 Invite
  </button>

  {#if open}
    <div class="pop">
      <p class="ph">Scan or share to join as a Player</p>
      {#if loopback}
        <p class="warn">
          ⚠ Opened on <b>{location.hostname}</b> — that only works on this machine. Reopen the app
          via your laptop's network address (e.g.
          <code>http://192.168.x.x:{location.port || 8080}</code>) so other devices can reach this QR.
        </p>
      {/if}
      <div class="qrow">
        <div class="qr">{@html qr}</div>
        <div class="jurl">
          <input
            class="urlbox"
            bind:this={urlEl}
            value={link}
            readonly
            onfocus={(e) => (e.target as HTMLInputElement).select()}
          />
          <button class="mini" onclick={copy}>{copied ? 'Copied' : 'Copy link'}</button>
        </div>
      </div>
      <p class="code-line">Session code: <b>{sid}</b></p>
    </div>
  {/if}
</div>

<style>
  .share {
    position: relative;
    flex: none;
  }
  .share-btn {
    cursor: pointer;
    color: #cfe8ff;
    background: #182230;
    border: 1px solid #2a3b4e;
    border-radius: 8px;
    padding: 6px 12px;
    font-size: 0.82rem;
  }
  .share-btn:hover,
  .share-btn.open {
    border-color: #4fd1c5;
  }
  .pop {
    position: absolute;
    top: calc(100% + 8px);
    left: 0;
    z-index: 30;
    width: min(360px, 86vw);
    background: #0f1218;
    border: 1px solid #2f4a5a;
    border-radius: 12px;
    padding: 12px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
  }
  .ph {
    margin: 0 0 10px;
    font-size: 0.85rem;
    color: var(--fg, #e6edf3);
  }
  .qrow {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-wrap: wrap;
  }
  .qr {
    width: 132px;
    height: 132px;
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
  .jurl {
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 170px;
    flex: 1;
  }
  .urlbox {
    width: 100%;
    font-family: ui-monospace, monospace;
    font-size: 0.74rem;
    background: #0b0e13;
    color: #cfe8ff;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 8px 10px;
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
  .code-line {
    margin: 10px 0 0;
    font-size: 0.78rem;
    color: var(--muted, #8b93a3);
  }
  .code-line b {
    font-family: ui-monospace, monospace;
    letter-spacing: 0.08em;
    color: var(--fg, #e6edf3);
  }
  .warn {
    color: #ffcf6b;
    font-size: 0.78rem;
    background: #241c0f;
    border: 1px solid #4a3a1f;
    border-radius: 8px;
    padding: 8px 10px;
    margin: 0 0 10px;
  }
  .warn code {
    font-size: 0.74rem;
  }
</style>
