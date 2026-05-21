<!--
  §7 / Figure 5: the decoded staircase.

  Trains a small recurrent network in modal (poles, residues = α·β) coordinates
  via gradient flow on a multi-frequency impulse-response target.  Three
  synced panels:

    1.  Loss curve (log y) — clean staircase descent.
    2.  Effective rank ρ(τ) — integer step function climbing from 0 to n.
    3.  z-plane — live pole positions, with target ghost markers and the
        numerator zeros of the *current* system (so the reader can watch
        each zero "leave" its pole as the corresponding mode activates).

  The training runs in a Web Worker; the scrubber lets the reader step
  through the recorded trajectory.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ZPlane, type ZPlanePoint } from '../lib/plots/ZPlane';
  import { TimeSeries } from '../lib/plots/TimeSeries';
  import {
    defaultTarget,
    toModalSystem,
    type TraceSnapshot,
    type ModalTarget,
  } from '../lib/gradientFlow';
  import { zeros as zerosOfSystem } from '../lib/transferFn';

  const T_HORIZON = 160;
  const target: ModalTarget = defaultTarget(T_HORIZON);

  // Hand-tuned for a clean four-cliff staircase in ~30k steps (see
  // gradientFlow.ts comments). The worker runs this in well under a second
  // even on a midrange laptop.
  const cfg = {
    initScale: 5e-3,
    seed: 2,
    dt: 2e-3,
    steps: 30000,
    snapshots: 240,
    rhoThreshold: 0.1,
  };

  let trace: TraceSnapshot[] = [];
  let cursor = 0;
  let playing = false;
  let playTimer: number | null = null;
  let worker: Worker | null = null;
  let loading = true;

  let zSvg: SVGSVGElement;
  let lossSvg: SVGSVGElement;
  let rhoSvg: SVGSVGElement;
  let zPlane: ZPlane | null = null;
  let lossPlot: TimeSeries | null = null;
  let rhoPlot: TimeSeries | null = null;

  // Per-mode colors — picked to match the article's accent palette and to
  // remain distinguishable on the z-plane and in the residue legend.
  const MODE_COLORS = ['#d1495b', '#edae49', '#66a182', '#2e4057'];

  function startTraining(): void {
    loading = true;
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
    worker.postMessage({ kind: 'run', config: cfg });
  }

  function pointsForSnapshot(snap: TraceSnapshot): ZPlanePoint[] {
    const pts: ZPlanePoint[] = [];
    // Ghost target poles + ghost target zeros.
    const targetSys = toModalSystem({ modes: target.modes });
    for (let k = 0; k < target.modes.length; k++) {
      const m = target.modes[k];
      const p = m.kind === 'real' ? { re: m.p, im: 0 } : m.p;
      pts.push({ id: `ghost-pole-${k}`, z: p, kind: 'ghost-pole', draggable: false });
      if (m.kind === 'pair') {
        pts.push({
          id: `ghost-pole-${k}-conj`,
          z: { re: p.re, im: -p.im },
          kind: 'ghost-pole',
          draggable: false,
        });
      }
    }
    const targetZeros = zerosOfSystem(targetSys);
    targetZeros.forEach((z, i) =>
      pts.push({ id: `ghost-zero-${i}`, z, kind: 'ghost-zero', draggable: false }),
    );

    // Live poles (full list incl. conjugates), colored by mode.
    for (let k = 0; k < snap.state.modes.length; k++) {
      const m = snap.state.modes[k];
      const color = MODE_COLORS[k % MODE_COLORS.length];
      const mag = m.kind === 'real'
        ? Math.abs(m.alpha * m.beta)
        : Math.hypot(m.alpha.re * m.beta.re - m.alpha.im * m.beta.im,
                     m.alpha.re * m.beta.im + m.alpha.im * m.beta.re);
      const active = mag > cfg.rhoThreshold;
      const c = active ? color : 'var(--text-faint, #bbb)';
      if (m.kind === 'real') {
        pts.push({ id: `pole-${k}`, z: { re: m.p, im: 0 }, kind: 'pole', color: c, draggable: false });
      } else {
        pts.push({ id: `pole-${k}`, z: m.p, kind: 'pole', color: c, draggable: false });
        pts.push({
          id: `pole-${k}-conj`,
          z: { re: m.p.re, im: -m.p.im },
          kind: 'pole',
          color: c,
          draggable: false,
        });
      }
    }

    // Live numerator zeros (so the reader can watch them detach from poles
    // when the residue grows).
    const liveSys = toModalSystem(snap.state);
    const liveZeros = zerosOfSystem(liveSys);
    liveZeros.forEach((z, i) =>
      pts.push({ id: `zero-${i}`, z, kind: 'zero', draggable: false }),
    );
    return pts;
  }

  function redraw(): void {
    if (!trace.length || !zPlane || !lossPlot || !rhoPlot) return;
    const snap = trace[Math.min(cursor, trace.length - 1)];
    zPlane.update(pointsForSnapshot(snap));

    // Loss curve up through the cursor + ghost-trailing.
    const lossSeen: number[] = trace.slice(0, cursor + 1).map((s) => s.loss);
    const lossAll: number[] = trace.map((s) => s.loss);
    const rhoSeen: number[] = trace.slice(0, cursor + 1).map((s) => s.rho);
    const rhoAll: number[] = trace.map((s) => s.rho);

    lossPlot.update([
      {
        id: 'loss-all',
        values: lossAll,
        color: 'var(--text-faint, #ccc)',
        style: 'line',
        width: 1,
        dasharray: '2 3',
      },
      {
        id: 'loss-seen',
        values: lossSeen,
        color: 'var(--accent-active, #d1495b)',
        style: 'line',
        width: 2.2,
      },
    ]);

    rhoPlot.update([
      {
        id: 'rho-all',
        values: rhoAll,
        color: 'var(--text-faint, #ccc)',
        style: 'line',
        width: 1,
        dasharray: '2 3',
      },
      {
        id: 'rho-seen',
        values: rhoSeen,
        color: '#2e4057',
        style: 'line',
        width: 2.2,
      },
    ]);
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
      // ~30 fps; stride implicit via snapshots count.
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

  onMount(() => {
    zPlane = new ZPlane(zSvg, {});
    lossPlot = new TimeSeries(lossSvg, {
      xLabel: 'training time τ (snapshot index)',
      yLabel: 'loss',
      yLog: true,
    });
    rhoPlot = new TimeSeries(rhoSvg, {
      xLabel: 'training time τ',
      yLabel: 'effective rank ρ',
      yMin: -0.3,
      yMax: target.modes.length + 0.3,
    });
    startTraining();
  });

  onDestroy(() => {
    pause();
    worker?.terminate();
  });

  $: tauLabel = trace[cursor]?.tau ?? 0;
  $: lossLabel = trace[cursor]?.loss ?? 0;
  $: rhoLabel = trace[cursor]?.rho ?? 0;
</script>

<div class="widget widget--staircase">
  <div class="widget-row widget-row--three">
    <div class="widget-panel">
      <div class="widget-panel-header">loss L(τ)</div>
      <svg bind:this={lossSvg}></svg>
    </div>
    <div class="widget-panel">
      <div class="widget-panel-header">effective rank ρ(τ)</div>
      <svg bind:this={rhoSvg}></svg>
    </div>
    <div class="widget-panel widget-panel--zplane">
      <div class="widget-panel-header">z-plane</div>
      <svg bind:this={zSvg}></svg>
    </div>
  </div>

  <div class="widget-controls staircase-controls">
    <div class="widget-btn-row">
      <button class="widget-btn" on:click={playing ? pause : play} disabled={loading || !trace.length}>
        {playing ? 'pause' : 'play'}
      </button>
      <button class="widget-btn" on:click={restart} disabled={loading || !trace.length}>restart</button>
      <span class="staircase-stats">
        {#if loading}
          training…
        {:else}
          τ = {tauLabel} &nbsp;·&nbsp; L = {lossLabel.toExponential(2)} &nbsp;·&nbsp; ρ = {rhoLabel}
        {/if}
      </span>
    </div>
    <input
      type="range"
      min="0"
      max={Math.max(1, trace.length - 1)}
      value={cursor}
      on:input={onScrub}
      disabled={loading || !trace.length}
    />
    <p class="widget-hint">
      Each cliff in L(τ) is one pole–zero pair separating in the complex
      plane. Watch ρ(τ) step up in lockstep, and watch the numerator zeros
      (○) peel away from the live poles (×) as their residues grow.
    </p>
  </div>
</div>

<style>
  .widget--staircase svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .widget-panel--zplane {
    aspect-ratio: 1 / 1;
  }
  .widget-row--three {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: 1fr;
  }
  @media (min-width: 720px) {
    .widget-row--three {
      grid-template-columns: 1.1fr 1.1fr 1fr;
      align-items: stretch;
    }
  }
  .staircase-controls input[type='range'] {
    width: 100%;
  }
  .staircase-stats {
    font-family: var(--font-mono, JetBrains Mono, monospace);
    font-size: 12px;
    color: var(--text-soft);
    margin-left: auto;
  }
</style>
