<script lang="ts">
  import { onMount } from 'svelte';
  import { session, SEAT } from './session.svelte';
  import Home from './components/Home.svelte';
  import NewProject from './components/NewProject.svelte';
  import RoleChooser from './components/RoleChooser.svelte';
  import TransportPanel from './components/TransportPanel.svelte';
  import Chart from './components/Chart.svelte';
  import MaestroControls from './components/MaestroControls.svelte';
  import MaestroMedia from './components/MaestroMedia.svelte';
  import SessionShare from './components/SessionShare.svelte';
  import ViewModeToggle from './components/ViewModeToggle.svelte';
  import TransportBar from './components/TransportBar.svelte';
  import Editor from './components/Editor.svelte';

  onMount(() => session?.start());

  // Landing: no seat AND no project chosen → the project list (Home). With a
  // project but no seat → the seat picker. A seat → the app for that project.
  const urlParams = new URLSearchParams(location.search);
  const hasProject = urlParams.has('project');
  const isNew = urlParams.has('new');
</script>

<header>
  <h1>bandAssemble <span class="tag">svelte port</span></h1>
  <span class="build" title="Build timestamp. If two devices show different values, one is on a stale bundle — hard-reload it.">build {__APP_BUILD__}</span>
  {#if session}
    <div class="pill" class:ok={session.conn === 'connected'} class:bad={session.conn !== 'connected'}>
      {session.conn}
    </div>
  {/if}
</header>

{#if session && SEAT && session.conn !== 'connected'}
  <div class="wsdiag" role="status">
    <span class="lbl">no sync —</span>
    trying <code>{session.wsUrl || '…'}</code>
    {#if session.connInfo}<span class="why">· {session.connInfo}</span>{/if}
    {#if session.connAttempts > 1}<span class="att">· attempt {session.connAttempts}</span>{/if}
  </div>
{/if}

{#if !SEAT && isNew}
  <NewProject />
{:else if !SEAT && !hasProject}
  <Home />
{:else if !SEAT}
  <RoleChooser />
{:else if SEAT === 'editor'}
  <Editor />
{:else if session}
  <section class="stage">
    <div class="topbar">
      <div class="role-badge {SEAT}">{SEAT === 'maestro' ? '🎛️ MAESTRO' : '📱 PLAYER'}</div>
      <SessionShare />
      <details class="meta">
        <summary>details</summary>
        <div class="meta-body">
          <TransportPanel />
          {#if SEAT === 'maestro'}
            <MaestroControls />
          {/if}
          <ViewModeToggle />
        </div>
      </details>
    </div>
    {#if SEAT === 'maestro'}
      <MaestroMedia />
    {/if}
    <div class="chart-fill">
      <Chart />
    </div>
  </section>
  <TransportBar />
{/if}

<style>
  /* Full-screen performance stage: the chart fills everything between the header
     and the sticky transport bar. Overrides the centered, max-width section. */
  .stage {
    max-width: none;
    margin: 0;
    height: calc(100dvh - 58px); /* header */
    padding: 10px 16px 78px; /* bottom clears the fixed TransportBar */
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .topbar {
    flex: none;
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  .topbar .role-badge {
    margin-bottom: 0;
  }
  .meta {
    font-size: 12px;
    color: var(--muted);
  }
  .meta summary {
    cursor: pointer;
    user-select: none;
    padding: 5px 10px;
    border: 1px solid var(--line);
    border-radius: 8px;
    list-style: none;
  }
  .meta summary::-webkit-details-marker {
    display: none;
  }
  .meta[open] summary {
    border-color: var(--accent);
  }
  .meta-body {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    margin-top: 10px;
    max-width: 640px;
  }
  .chart-fill {
    flex: 1;
    min-height: 0;
  }
  /* Connection diagnostic strip — only while a seat is open and not connected. */
  .wsdiag {
    margin: 0 16px 8px;
    padding: 7px 12px;
    background: #241c0f;
    border: 1px solid #4a3a1f;
    border-radius: 8px;
    color: #ffcf6b;
    font-size: 0.78rem;
    line-height: 1.35;
    word-break: break-all;
  }
  .wsdiag .lbl {
    font-weight: 650;
  }
  .wsdiag code {
    font-family: ui-monospace, monospace;
    font-size: 0.74rem;
    color: #e6edf3;
  }
  .wsdiag .why {
    color: #ffb4b0;
  }
  .wsdiag .att {
    color: #8b93a3;
  }
  /* Build stamp — muted, pushed to the right so the connection pill sits beside it. */
  .build {
    margin-left: auto;
    font-family: ui-monospace, monospace;
    font-size: 0.68rem;
    color: #6b7280;
    white-space: nowrap;
  }
</style>
