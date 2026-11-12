<script lang="ts">
  import { onMount } from 'svelte';
  import { session, ROLE } from './session.svelte';
  import RoleChooser from './components/RoleChooser.svelte';
  import TransportPanel from './components/TransportPanel.svelte';
  import Chart from './components/Chart.svelte';
  import MasterControls from './components/MasterControls.svelte';
  import ClientControls from './components/ClientControls.svelte';

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

{#if !ROLE}
  <RoleChooser />
{:else if session}
  <section>
    <div class="role-badge {ROLE}">{ROLE === 'master' ? '🎛️ MASTER' : '📱 CLIENT'}</div>
    <div class="grid">
      <div class="panel">
        <h2>Transport</h2>
        <TransportPanel />
        {#if ROLE === 'master'}
          <MasterControls />
        {:else}
          <ClientControls />
        {/if}
      </div>
      <div class="panel">
        <h2>{ROLE === 'client' ? 'Your chart (follows master)' : 'Chart'}</h2>
        <Chart />
      </div>
    </div>
  </section>
{/if}
