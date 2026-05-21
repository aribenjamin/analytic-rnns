<!--
  §1 / Figure: the Saxe et al. saddle-to-saddle staircase for a deep linear
  feedforward network. The opening visual hook of the post: each plateau is a
  saddle, each cliff is one singular direction activating. By the end the
  reader should walk away with "modes are the unit of learning."
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { TimeSeries } from '../lib/plots/TimeSeries';
  import { trajectory, type SaxeTrajectory } from '../lib/saxe';

  const SIGMA_STARS = [2.4, 1.6, 0.9, 0.4];
  const TRACE_COLORS = [
    'var(--accent-active, #d05a3a)',
    'var(--accent, #1f6feb)',
    'var(--accent-pole, #6a4cb8)',
    'var(--accent-target, #2a9d8f)',
  ];

  let sigma0 = 0.01;
  let tauMax = 14;
  const STEPS = 400;

  let traj: SaxeTrajectory = trajectory(SIGMA_STARS, sigma0, tauMax, STEPS);

  let lossSvg: SVGSVGElement;
  let sigmaSvg: SVGSVGElement;
  let lossPlot: TimeSeries | null = null;
  let sigmaPlot: TimeSeries | null = null;

  let playing = false;
  let cursor = STEPS - 1;
  let rafId = 0;
  let lastT = 0;

  function recompute(): void {
    traj = trajectory(SIGMA_STARS, sigma0, tauMax, STEPS);
    cursor = Math.min(cursor, STEPS - 1);
    redraw();
  }

  function redraw(): void {
    if (!lossPlot || !sigmaPlot) return;
    const upTo = cursor + 1;
    // Show the loss curve up to the cursor with a faint full-trajectory
    // backdrop so the staircase shape is legible even before play.
    lossPlot.update([
      {
        id: 'loss-full',
        values: traj.loss,
        color: 'var(--text-muted, #b9b9b9)',
        width: 1,
        dasharray: '3,3',
      },
      {
        id: 'loss',
        values: traj.loss.slice(0, upTo),
        color: 'var(--accent-active, #d05a3a)',
        width: 2.5,
      },
    ]);
    const sigmaTraces = traj.sigmas.map((s, k) => ({
      id: `sigma-${k}`,
      values: s.slice(0, upTo),
      color: TRACE_COLORS[k % TRACE_COLORS.length],
      width: 2.25,
    }));
    // Dashed lines at the targets sigma_k* so the reader sees what each mode
    // is converging to.
    const targets = SIGMA_STARS.map((sStar, k) => ({
      id: `target-${k}`,
      values: new Array(STEPS).fill(sStar),
      color: TRACE_COLORS[k % TRACE_COLORS.length],
      width: 1,
      dasharray: '2,4',
    }));
    sigmaPlot.update([...targets, ...sigmaTraces]);
  }

  function tick(t: number): void {
    if (!playing) return;
    if (lastT === 0) lastT = t;
    const dt = (t - lastT) / 1000;
    lastT = t;
    // Sweep the full trajectory in ~4 seconds.
    cursor = Math.min(STEPS - 1, cursor + Math.ceil(dt * (STEPS / 4)));
    redraw();
    if (cursor >= STEPS - 1) {
      playing = false;
      lastT = 0;
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  function play(): void {
    if (cursor >= STEPS - 1) cursor = 0;
    playing = true;
    lastT = 0;
    rafId = requestAnimationFrame(tick);
  }
  function pause(): void {
    playing = false;
    cancelAnimationFrame(rafId);
  }
  function reset(): void {
    pause();
    cursor = 0;
    redraw();
  }

  onMount(() => {
    lossPlot = new TimeSeries(lossSvg, {
      xLabel: 'training time τ',
      yLabel: 'loss',
      yMin: 0,
    });
    sigmaPlot = new TimeSeries(sigmaSvg, {
      xLabel: 'training time τ',
      yLabel: 'σ_k(τ)',
      yMin: 0,
      yMax: Math.max(...SIGMA_STARS) * 1.1,
    });
    redraw();
  });
</script>

<div class="widget widget--ff-staircase">
  <div class="widget-row widget-row--two">
    <div class="widget-panel">
      <div class="widget-panel-header">loss L(τ)</div>
      <svg bind:this={lossSvg}></svg>
    </div>
    <div class="widget-panel">
      <div class="widget-panel-header">singular values σ<sub>k</sub>(τ)</div>
      <svg bind:this={sigmaSvg}></svg>
    </div>
  </div>
  <div class="widget-controls widget-controls--row">
    <div class="widget-btn-row">
      {#if playing}
        <button class="widget-btn" on:click={pause}>pause</button>
      {:else}
        <button class="widget-btn" on:click={play}>
          {cursor >= STEPS - 1 ? 'replay' : 'play'}
        </button>
      {/if}
      <button class="widget-btn" on:click={reset}>reset</button>
    </div>
    <label>
      init scale σ⁰ = {sigma0.toExponential(1)}
      <input
        type="range"
        min={-4}
        max={-1}
        step={0.25}
        value={Math.log10(sigma0)}
        on:input={(e) => {
          sigma0 = Math.pow(10, parseFloat(e.currentTarget.value));
          recompute();
        }}
      />
    </label>
    <label>
      τ<sub>max</sub> = {tauMax.toFixed(1)}
      <input
        type="range"
        min={4}
        max={30}
        step={0.5}
        bind:value={tauMax}
        on:input={recompute}
      />
    </label>
  </div>
  <p class="widget-hint">
    The end-to-end map W<sub>2</sub>W<sub>1</sub> has four singular values
    {SIGMA_STARS.map((s) => s.toFixed(1)).join(', ')}. Each rises from the
    initialization to its target along an independent sigmoid, but because the
    learning rate of mode <em>k</em> scales with σ<sub>k</sub><sup>*</sup>, the
    largest mode activates first — producing the saddle-to-saddle staircase in
    the loss. Lower the init scale to make the plateaus sharper.
  </p>
</div>

<style>
  .widget--ff-staircase svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .widget-controls--row {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }
  .widget-controls--row label {
    display: flex;
    flex-direction: column;
    font-size: 0.85rem;
    min-width: 180px;
  }
  @media (max-width: 720px) {
    .widget--ff-staircase :global(.widget-row--two) {
      flex-direction: column;
    }
    .widget-controls--row {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
