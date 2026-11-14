<script lang="ts">
  // A read-only, WRAPPING link field + Copy button. Shared by the seat chooser
  // (RoleChooser) and the in-session Invite (SessionShare), which both show a LAN
  // join link that has to be copyable even over plain http.
  //
  // Why a <div>, not an <input>: an <input> can't wrap, so a long LAN URL ran off
  // the field. This box wraps (word-break) and a tap selects it all (user-select).
  //
  // Copy uses the shared helper (async Clipboard API with a hidden-textarea
  // execCommand fallback for plain-http LAN, where there's no secure context).
  // We flash "Copied" on press regardless of the result: a real tap is a user
  // gesture, so the copy succeeds in practice, and if it somehow doesn't,
  // user-select:all on the box still lets a tap select the whole link to copy by hand.
  import { copyText } from '../lib/clipboard';

  let { link, label = 'Copy link' }: { link: string; label?: string } = $props();

  let copied = $state(false);

  async function copy() {
    void copyText(link);
    copied = true;
    setTimeout(() => (copied = false), 3000);
  }
</script>

<div class="jurl">
  <div class="urlbox">{link}</div>
  <button class="mini" onclick={copy}>{copied ? 'Copied' : label}</button>
</div>

<style>
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
    font-size: 0.76rem;
    line-height: 1.5;
    background: #0b0e13;
    color: #cfe8ff;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 8px 10px;
    /* wrap the long LAN link onto multiple lines instead of clipping it */
    word-break: break-all;
    overflow-wrap: anywhere;
    user-select: all; /* one tap selects the whole link for a manual copy */
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
</style>
