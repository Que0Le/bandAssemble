<script lang="ts">
  import { onMount } from 'svelte';
  import { session, SEAT } from './session.svelte';
  import RoleChooser from './components/RoleChooser.svelte';
  import TransportPanel from './components/TransportPanel.svelte';
  import Chart from './components/Chart.svelte';
  import MaestroControls from './components/MaestroControls.svelte';
  import PlayerControls from './components/PlayerControls.svelte';
  import Editor from './components/Editor.svelte';

  onMount(() => session?.start());
</script>

<header>
  <h1>bandAssemble <span class="tag">svelte port</span></h1>
  {#if session}
    <div class="pill" class:ok={session.conn === 'connected'} class:bad={session.conn !== 'connected'}>
      {session.conn}
    </div>
  {/if}
</header>

{#if !SEAT}
  <RoleChooser />
{:else if SEAT === 'editor'}
  <Editor />
{:else if session}
  <section>
    <div class="role-badge {SEAT}">{SEAT === 'maestro' ? '🎛️ MAESTRO' : '📱 PLAYER'}</div>
    <div class="grid">
      <div class="panel">
        <h2>Transport</h2>
        <TransportPanel />
        {#if SEAT === 'maestro'}
          <MaestroControls />
        {:else}
          <PlayerControls />
        {/if}
      </div>
      <div class="panel">
        <h2>{SEAT === 'player' ? 'Your chart (follows Maestro)' : 'Chart'}</h2>
        <Chart />
      </div>
    </div>
  </section>
{/if}
