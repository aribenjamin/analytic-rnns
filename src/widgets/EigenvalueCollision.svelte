<!--
  §8 widget: eigenvalue collision and bifurcation.

  Trains a (W, b, c) student (n=3) on a fixed target with one complex-conjugate
  pair + one real pole. The network starts with all-real eigenvalues near zero
  (small Gaussian init). During training, two real eigenvalues approach each
  other, collide on the real axis, and bifurcate into a complex-conjugate pair.

  Two panels:
    1. z-plane with eigenvalue trails showing the collision
    2. Re(λ) and Im(λ) vs training time — convergence then bifurcation
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ZPlane, type ZPlanePoint, type ZPlaneTrail } from '../lib/plots/ZPlane';
  import { TimeSeries } from '../lib/plots/TimeSeries';
  import {
    type TraceSnapshot,
    type ModalTarget,
    type Mode,
    impulseResponseOfModes,
  } from '../lib/gradientFlow';
  import { totalDimOfModes, type InputKind } from '../lib/rnnTrain';
  import type { Complex } from '../lib/complex';

  const T_HORIZON = 160;
  const TOTAL_DIM = 3;

  // Fixed target: 1 complex pair + 1 real pole = 3 dimensions.
  // The complex pair forces eigenvalue collision during training.
  const targetModes: Mode[] = [
    {
      kind: 'pair',
      p: { re: 0.7 * Math.cos(Math.PI / 4), im: 0.7 * Math.sin(Math.PI / 4) },
      alpha: { re: Math.sqrt(0.9) * Math.cos(Math.PI / 8), im: Math.sqrt(0.9) * Math.sin(Math.PI / 8) },
      beta: { re: Math.sqrt(0.9) * Math.cos(Math.PI / 8), im: Math.sqrt(0.9) * Math.sin(Math.PI / 8) },
    },
    { kind: 'real', p: 0.5, alpha: Math.sqrt(0.7), beta: Math.sqrt(0.7) },
  ];

  function buildTarget(): ModalTarget {
    const gStar = impulseResponseOfModes(targetModes, T_HORIZON);
    return { modes: targetModes, gStar, T: T_HORIZON };
  }

  let initScaleLog = -2.5;
  $: initScale = Math.pow(10, initScaleLog);
  let runSeed = 7;

  const cfg = {
    dt: 2e-3,
    steps: 30000,
    snapshots: 300,
    rhoThreshold: 0.1,
  };

  let target: ModalTarget = buildTarget();
  let trace: TraceSnapshot[] = [];
  let cursor = 0;
  let playing = false;
  let playTimer: number | null = null;
  let worker: Worker | null = null;
  let loading = true;

  let zSvg: SVGSVGElement;
  let reSvg: SVGSVGElement;
  let imSvg: SVGSVGElement;
  let zPlane: ZPlane | null = null;
  let rePlot: TimeSeries | null = null;
  let imPlot: TimeSeries | null = null;

  const EIGS_COLORS = ['#d1495b', '#edae49', '#66a182'];

  // Extract eigenvalue positions from a snapshot. The modes may reorganize
  // (real → complex pair or vice versa), so we extract raw eigenvalue positions.
  interface EigEntry { re: number; im: number; }

  function eigenvaluesFromSnapshot(snap: TraceSnapshot): EigEntry[] {
    const eigs: EigEntry[] = [];
    for (const m of snap.state.modes) {
      if (m.kind === 'real') {
        eigs.push({ re: m.p as number, im: 0 });
      } else {
        eigs.push({ re: (m.p as Complex).re, im: (m.p as Complex).im });
        eigs.push({ re: (m.p as Complex).re, im: -(m.p as Complex).im });
      }
    }
    return eigs;
  }

  // Track eigenvalue identity across snapshots via greedy nearest-neighbor.
  function trackEigenvalues(allTrace: TraceSnapshot[], upTo: number): EigEntry[][] {
    const n = TOTAL_DIM;
    const tracked: EigEntry[][] = Array.from({ length: n }, () => []);
    if (!allTrace.length) return tracked;

    let prev = eigenvaluesFromSnapshot(allTrace[0]);
    // Initial assignment: just use the order
    for (let j = 0; j < Math.min(n, prev.length); j++) {
      tracked[j].push(prev[j]);
    }

    for (let t = 1; t <= upTo && t < allTrace.length; t++) {
      const curr = eigenvaluesFromSnapshot(allTrace[t]);
      const used = new Array(curr.length).fill(false);
      const assignment = new Array<number>(n).fill(-1);

      for (let j = 0; j < n; j++) {
        if (j >= prev.length) break;
        let bestIdx = -1;
        let bestDist = Infinity;
        for (let c = 0; c < curr.length; c++) {
          if (used[c]) continue;
          const d = Math.hypot(curr[c].re - prev[j].re, curr[c].im - prev[j].im);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = c;
          }
        }
        if (bestIdx >= 0) {
          assignment[j] = bestIdx;
          used[bestIdx] = true;
        }
      }

      const nextPrev: EigEntry[] = [];
      for (let j = 0; j < n; j++) {
        const idx = assignment[j];
        if (idx >= 0) {
          tracked[j].push(curr[idx]);
          nextPrev.push(curr[idx]);
        } else {
          tracked[j].push(tracked[j][tracked[j].length - 1] ?? { re: 0, im: 0 });
          nextPrev.push(prev[j] ?? { re: 0, im: 0 });
        }
      }
      prev = nextPrev;
    }
    return tracked;
  }

  function redraw(): void {
    if (!trace.length || !zPlane || !rePlot || !imPlot) return;
    const snap = trace[Math.min(cursor, trace.length - 1)];
    const tracked = trackEigenvalues(trace, cursor);

    // z-plane points
    const pts: ZPlanePoint[] = [];
    // Ghost target poles
    for (const m of targetModes) {
      if (m.kind === 'pair') {
        const p = m.p as Complex;
        pts.push({ id: 'ghost-pair-0', z: p, kind: 'ghost-pole', draggable: false });
        pts.push({ id: 'ghost-pair-0-conj', z: { re: p.re, im: -p.im }, kind: 'ghost-pole', draggable: false });
      } else {
        pts.push({ id: 'ghost-real-0', z: { re: m.p as number, im: 0 }, kind: 'ghost-pole', draggable: false });
      }
    }
    // Live eigenvalues
    for (let j = 0; j < TOTAL_DIM; j++) {
      const pos = tracked[j][tracked[j].length - 1];
      if (!pos) continue;
      pts.push({
        id: `eig-${j}`,
        z: pos,
        kind: 'pole',
        color: EIGS_COLORS[j % EIGS_COLORS.length],
        draggable: false,
      });
    }
    zPlane.update(pts);

    // Trails
    const trails: ZPlaneTrail[] = [];
    for (let j = 0; j < TOTAL_DIM; j++) {
      if (tracked[j].length > 1) {
        trails.push({
          id: `trail-${j}`,
          points: tracked[j],
          color: EIGS_COLORS[j % EIGS_COLORS.length],
        });
      }
    }
    zPlane.setTrails(trails);

    // Re(λ) and Im(λ) vs snapshot index
    const reTraces: { id: string; values: number[]; color: string; style: 'line'; width: number }[] = [];
    const imTraces: { id: string; values: number[]; color: string; style: 'line'; width: number }[] = [];
    for (let j = 0; j < TOTAL_DIM; j++) {
      const reVals = tracked[j].map((e) => e.re);
      const imVals = tracked[j].map((e) => e.im);
      reTraces.push({ id: `re-${j}`, values: reVals, color: EIGS_COLORS[j % EIGS_COLORS.length], style: 'line', width: 2 });
      imTraces.push({ id: `im-${j}`, values: imVals, color: EIGS_COLORS[j % EIGS_COLORS.length], style: 'line', width: 2 });
    }
    rePlot.update(reTraces);
    imPlot.update(imTraces);
  }

  function play(): void {
    if (!trace.length) return;
    playing = true;
    if (cursor >= trace.length - 1) cursor = 0;
    const tick = (): void => {
      cursor++;
      if (cursor >= trace.length - 1) {
        cursor = trace.length - 1;
        playing = false;
        playTimer = null;
        redraw();
        return;
      }
      redraw();
      playTimer = window.setTimeout(tick, 40);
    };
    tick();
  }

  function pause(): void {
    playing = false;
    if (playTimer !== null) {
      window.clearTimeout(playTimer);
      playTimer = null;
    }
  }

  function restart(): void {
    pause();
    cursor = 0;
    redraw();
  }

  function onScrub(ev: Event): void {
    const v = +(ev.target as HTMLInputElement).value;
    cursor = Math.max(0, Math.min(trace.length - 1, Math.round(v)));
    redraw();
  }

  function startTraining(): void {
    pause();
    worker?.terminate();
    loading = true;
    cursor = 0;
    trace = [];

    worker = new Worker(new URL('../workers/train.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (ev: MessageEvent) => {
      const m = ev.data as { kind: string; trace?: TraceSnapshot[] };
      if (m.kind === 'trace' && m.trace) {
        trace = m.trace;
        cursor = trace.length - 1;
        loading = false;
        redraw();
      }
    };
    worker.postMessage({
      kind: 'run',
      config: {
        mode: 'direct',
        target,
        initScale,
        seed: runSeed,
        n: TOTAL_DIM,
        dt: cfg.dt,
        steps: cfg.steps,
        snapshots: cfg.snapshots,
        rhoThreshold: cfg.rhoThreshold,
      },
    });
  }

  function newRun(): void {
    runSeed = (runSeed + 1) | 0;
    startTraining();
  }

  onMount(() => {
    zPlane = new ZPlane(zSvg, {});
    rePlot = new TimeSeries(reSvg, {
      width: 340,
      height: 120,
      xLabel: '',
      yLabel: 'Re(λ)',
      yMin: -1, yMax: 1,
      hideXTicks: true,
      margin: { top: 8, right: 14, bottom: 4, left: 48 },
      labelFontSize: 12,
    });
    imPlot = new TimeSeries(imSvg, {
      width: 340,
      height: 120,
      xLabel: 'training time τ',
      yLabel: 'Im(λ)',
      yMin: -1, yMax: 1,
      margin: { top: 4, right: 14, bottom: 36, left: 48 },
      labelFontSize: 12,
    });
    startTraining();
  });

  onDestroy(() => {
    pause();
    worker?.terminate();
  });

  $: tauLabel = trace[cursor]?.tau ?? 0;
</script>

<div class="widget widget--collision">
  <div class="widget-banner">Eigenvalue collision</div>

  <div class="widget-row widget-row--top">
    <div class="widget-panel widget-panel--zplane">
      <div class="widget-panel-header">z-plane — eigenvalue trajectories</div>
      <svg bind:this={zSvg}></svg>
    </div>
    <div class="widget-panel widget-panel--components">
      <div class="widget-panel-header">eigenvalue components vs training time</div>
      <svg class="comp-row" bind:this={reSvg}></svg>
      <svg class="comp-row" bind:this={imSvg}></svg>
    </div>
  </div>

  <div class="widget-controls collision-controls">
    <div class="widget-btn-row">
      <button class="widget-btn" on:click={playing ? pause : play} disabled={loading || !trace.length}>
        {playing ? 'pause' : 'play'}
      </button>
      <button class="widget-btn" on:click={restart} disabled={loading || !trace.length}>restart</button>
      <button class="widget-btn" on:click={newRun} disabled={loading}>new init</button>
      <span class="collision-stats">
        {#if loading}
          training…
        {:else}
          τ = {tauLabel}
        {/if}
      </span>
    </div>
    <div class="slider-row">
      <label class="slider-cell">
        <span class="slider-cell-label">training time τ</span>
        <input type="range" min="0" max={Math.max(1, trace.length - 1)} value={cursor} on:input={onScrub} disabled={loading || !trace.length} />
      </label>
    </div>
  </div>
</div>

<style>
  .widget--collision {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 100%;
    overflow: hidden;
  }
  .widget--collision svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .widget-panel--zplane { min-width: 0; }
  .widget-panel--components {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .comp-row { max-height: 120px; }
  .widget-row--top {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: 1fr;
  }
  @media (min-width: 760px) {
    .widget-row--top {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      align-items: start;
    }
  }
  .collision-controls input[type='range'] { width: 100%; }
  .slider-row {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4, 16px);
    font-size: 0.85rem;
  }
  .slider-cell {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }
  .slider-cell input[type='range'] { width: 100%; }
  .slider-cell-label { color: var(--text-soft, #555); }
  .collision-stats {
    font-family: var(--font-mono, JetBrains Mono, monospace);
    font-size: 13px;
    color: var(--text-soft);
    margin-left: auto;
  }
  .widget-panel--zplane .widget-panel-header,
  .widget-panel--components .widget-panel-header {
    font-size: 12.5px;
  }
</style>
