<script lang="ts">
  // In-session "Invite" button for the top banner: shows the join link + QR so
  // other devices can jump into THIS room. The link carries the live session id
  // (session.sessionId — the room this device is actually in), not a fresh code,
  // so what you share always matches where you are. Reuses lib/join.
  import { joinUrl, qrSvg } from '../lib/join';
  import { session } from '../session.svelte';
  import CopyLinkBox from './CopyLinkBox.svelte';
  import LoopbackWarning from './LoopbackWarning.svelte';

  const sid = session!.sessionId;
  const link = joinUrl(sid); // ?session=<sid>&seat=player
  const qr = qrSvg(link);

  let open = $state(false);
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
      <LoopbackWarning />
      <div class="qrow">
        <div class="qr">{@html qr}</div>
        <CopyLinkBox {link} />
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
  .code-line {
    margin: 10px 0 0;
    font-size: 0.78rem;
    color: var(--muted, #8b93a3);
  }
  .code-line b {
    font-family: var(--mono);
    letter-spacing: 0.08em;
    color: var(--fg, #e6edf3);
  }
</style>
