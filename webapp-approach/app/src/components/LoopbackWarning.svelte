<script lang="ts">
  // Shown on the share surfaces (seat chooser + in-session Invite) when the app
  // was opened on a loopback host (localhost / 127.0.0.1): the QR + link then only
  // work on THIS machine, so other devices can't join. Self-gating — it renders
  // nothing unless the host is actually loopback, so callers just drop it in.
  import { isLoopbackHost } from '../lib/join';

  const loopback = isLoopbackHost();
  const addr = `http://192.168.x.x:${location.port || 8080}`;
</script>

{#if loopback}
  <p class="warn">
    ⚠ Opened on <b>{location.hostname}</b> — that only works on this machine. Reopen the app via
    your laptop's network address (e.g. <code>{addr}</code>) so other devices can reach this QR and
    link.
  </p>
{/if}

<style>
  .warn {
    color: #ffcf6b;
    font-size: 0.8rem;
    background: #241c0f;
    border: 1px solid #4a3a1f;
    border-radius: 8px;
    padding: 8px 10px;
    margin: 0 0 10px;
  }
  .warn code {
    font-size: 0.76rem;
  }
</style>
