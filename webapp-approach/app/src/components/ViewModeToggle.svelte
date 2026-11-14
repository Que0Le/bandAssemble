<script lang="ts">
  // Chart-layout switch, shown inside the (collapsible) "details" panel so it's a
  // hidable config. Pages = the two-page horizontal spread; Scroll = a single
  // full-width column that glides down (teleprompter) — the portrait-phone mode.
  import { view, setChartMode } from '../view.svelte';
</script>

<div class="vm">
  <span class="lbl">Chart view</span>
  <div class="seg">
    <button class:on={view.chartMode === 'pages'} onclick={() => setChartMode('pages')}>▭▭ Pages</button>
    <button class:on={view.chartMode === 'scroll'} onclick={() => setChartMode('scroll')}>≋ Scroll ↓</button>
  </div>
</div>

<style>
  .vm {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .lbl {
    font-size: 0.78rem;
    color: var(--muted, #8b93a3);
  }
  .seg {
    display: inline-flex;
    border: 1px solid #2a3b4e;
    border-radius: 8px;
    overflow: hidden;
  }
  .seg button {
    cursor: pointer;
    background: #141b24;
    color: #cfe8ff;
    border: none;
    padding: 5px 12px;
    font-size: 0.8rem;
  }
  .seg button + button {
    border-left: 1px solid #2a3b4e;
  }
  .seg button.on {
    background: #16271f;
    color: #bdf0cf;
  }
  .seg button:hover:not(.on) {
    background: #1b2430;
  }
</style>
