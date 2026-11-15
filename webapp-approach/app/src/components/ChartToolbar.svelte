<script lang="ts">
  // Chart toolbar: Role switcher, add-a-Role, Copy sheet, and the Edit toggle.
  import { view, roles, addRole, currentObjects, meta } from '../view.svelte';
  import { session, SEAT } from '../session.svelte';
  import { sheet } from '../lib/serialize';
  import { copyText } from '../lib/clipboard';

  let newRole = $state('');
  function addRoleNow() {
    const id = addRole(newRole);
    newRole = '';
    view.editing = false;
    view.roleId = id;
  }

  // Delete the selected Role (Maestro only; the project keeps at least one). A
  // two-step inline confirm, so no accidental deletes and no blocking dialog.
  let confirmDel = $state(false);
  const canDelete = $derived(SEAT === 'maestro' && roles.length > 1);
  const curRoleLabel = $derived(roles.find((r) => r.id === view.roleId)?.label ?? '');
  function deleteRoleNow() {
    session?.removeRole(view.roleId);
    confirmDel = false;
  }

  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  async function copySheet() {
    const ok = await copyText(sheet(meta.title, currentObjects()));
    copied = ok;
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = false), 1600);
  }
</script>

<div class="toolbar">
  <label class="role-pick"
    >Role
    <select bind:value={view.roleId}>
      {#each roles as r}<option value={r.id}>{r.label}</option>{/each}
    </select>
  </label>
  {#if canDelete}
    {#if confirmDel}
      <span class="del-confirm">
        Delete “{curRoleLabel}”?
        <button class="btn danger" onclick={deleteRoleNow}>Delete</button>
        <button class="btn" onclick={() => (confirmDel = false)}>Cancel</button>
      </span>
    {:else}
      <button
        class="btn del"
        title={`Delete the “${curRoleLabel}” role and its chart`}
        onclick={() => (confirmDel = true)}>🗑</button
      >
    {/if}
  {/if}
  <input
    class="new-role"
    placeholder="+ role"
    bind:value={newRole}
    onkeydown={(e) => e.key === 'Enter' && newRole.trim() && addRoleNow()}
  />
  {#if newRole.trim()}
    <button class="btn" onclick={addRoleNow}>Add</button>
  {/if}
  <span class="spacer"></span>
  {#if !view.editing}
    <button
      class="btn"
      class:on={view.autoScroll}
      onclick={() => (view.autoScroll = !view.autoScroll)}
      title="Auto-scroll pages while playing. Turn off to flip pages by hand — jumping to a section still scrolls."
    >
      {view.autoScroll ? '⇅ Auto-scroll: on' : '⇅ Auto-scroll: off'}
    </button>
    <span class="hint">Select any text to copy — or</span>
    <button class="btn" onclick={copySheet}>{copied ? '✓ Copied' : '⧉ Copy sheet'}</button>
  {/if}
  <button class="btn" onclick={() => (view.editing = !view.editing)}>
    {view.editing ? '✕ Close' : '✎ Quick edit'}
  </button>
</div>

<style>
  .toolbar {
    display: flex;
    flex-wrap: wrap; /* phones: wrap instead of overflowing off the right edge */
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    user-select: none;
  }
  /* Mouse-centric hint; drop it on narrow/touch screens where it just eats width. */
  @media (max-width: 640px) {
    .hint {
      display: none;
    }
    .spacer {
      flex-basis: 100%; /* push the right-hand buttons onto their own row */
    }
  }
  .spacer {
    flex: 1;
  }
  .hint {
    color: #8b93a3;
    font-size: 0.78rem;
  }
  .role-pick {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 0.78rem;
    color: #8b93a3;
  }
  .role-pick select,
  .new-role {
    background: #0f1218;
    color: #e6edf3;
    border: 1px solid #2a3340;
    border-radius: 8px;
    padding: 4px 8px;
    font-size: 0.82rem;
  }
  .new-role {
    width: 90px;
  }
  .btn {
    cursor: pointer;
    color: #cfe8ff;
    background: #182230;
    border: 1px solid #2a3b4e;
    border-radius: 8px;
    padding: 5px 12px;
    font-size: 0.82rem;
  }
  .btn:hover {
    border-color: #4fd1c5;
  }
  .btn.on {
    color: #bdf0cf;
    border-color: #2f6b45;
    background: #16271f;
  }
  .btn.del {
    padding: 5px 9px;
  }
  .btn.del:hover {
    border-color: #fc8181;
  }
  .del-confirm {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 0.8rem;
    color: #e6edf3;
  }
  .btn.danger {
    color: #ffd7d7;
    border-color: #6b2f2f;
    background: #271616;
  }
  .btn.danger:hover {
    border-color: #fc8181;
  }
</style>
