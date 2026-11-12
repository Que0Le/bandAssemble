<script lang="ts">
  // Inline editor for the current Role's chart. Edits are a LOCAL DRAFT in the
  // textarea; nothing changes for anyone until "Hand off", which sends the draft
  // to the Maestro to distribute. Timing is preserved from the existing chart
  // (the text format carries no times).
  import { session } from '../session.svelte';
  import { view, charts } from '../view.svelte';
  import { objectsText } from '../lib/serialize';
  import { parseSheet, reTime } from '../lib/parseSheet';

  const s = session!;
  const roleId = view.roleId; // the Role we opened for editing
  let draft = $state(objectsText(charts[roleId] ?? []));

  function handOff() {
    const objs = reTime(parseSheet(draft), charts[roleId] ?? []);
    s.handOff(roleId, objs);
    view.editing = false;
  }
</script>

<div class="edit">
  <p class="hint">
    Editing <b>{roleId}</b> — a local draft. <b>Hand off</b> sends it to the Maestro to
    share with the band; times are kept from the current chart.
  </p>
  <textarea class="draft" bind:value={draft} spellcheck="false"></textarea>
  <div class="actions">
    <button class="btn primary" onclick={handOff}>⤴ Hand off to band</button>
    <button class="btn" onclick={() => (view.editing = false)}>Cancel</button>
  </div>
</div>

<style>
  .edit {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .hint {
    color: #8b93a3;
    font-size: 0.8rem;
    margin: 0;
  }
  .draft {
    width: 100%;
    height: 46vh;
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
  .actions {
    display: flex;
    gap: 8px;
  }
  .btn {
    cursor: pointer;
    color: #e6edf3;
    background: #222a33;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 8px 14px;
    font-size: 14px;
  }
  .btn:hover {
    border-color: #4fd1c5;
  }
  .btn.primary {
    background: #1b3326;
    border-color: #2f6b45;
    color: #bdf0cf;
  }
</style>
