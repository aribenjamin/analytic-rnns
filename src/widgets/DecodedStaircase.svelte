<!--
  §7 / Figure 5: the decoded staircase.

  Trains a small recurrent network in modal (poles, residues = α·β) coordinates
  via gradient flow on a multi-frequency impulse-response target.  Three
  synced panels:

    1.  z-plane — live pole positions, with target ghost markers and the
        numerator zeros of the *current* system (so the reader can watch
        each zero "leave" its pole as the corresponding mode activates).
    2.  |H(e^{iθ})| — frequency response of the *current* system vs the
        target. This is the "what is the network learning?" view: each
        cliff in the loss adds a new peak to the magnitude response.
    3.  Loss curve (log y) — clean staircase descent, full-width below.

  The training runs in a Web Worker; the scrubber lets the reader step
  through the recorded trajectory.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ZPlane, type ZPlanePoint } from '../lib/plots/ZPlane';
  import { TimeSeries } from '../lib/plots/TimeSeries';
  import { BodePlot } from '../lib/plots/BodePlot';
  import {
    defaultTarget,
    toModalSystem,
    type TraceSnapshot,
    type ModalTarget,
  } from '../lib/gradientFlow';
  import { zeros as zerosOfSystem, frequencyResponse, evalH } from '../lib/transferFn';
  import { expi, abs as cabs } from '../lib/complex';

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
  let bodeSvg: SVGSVGElement;
  let zPlane: ZPlane | null = null;
  let lossPlot: TimeSeries | null = null;
  let bodePlot: BodePlot | null = null;

  const N_FREQ = 256;
  let targetMag: number[] = [];
  let freqTheta: number[] = [];
  let bodeYMax = 10;

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

  function magOnHalfCircle(sys: { poles: any[]; residues: any[] }): number[] {
    const out = new Array(N_FREQ);
    for (let i = 0; i < N_FREQ; i++) {
      const th = (Math.PI * i) / (N_FREQ - 1);
      out[i] = cabs(evalH(sys as any, expi(th)));
    }
    return out;
  }

  function redraw(): void {
    if (!trace.length || !zPlane || !lossPlot || !bodePlot) return;
    const snap = trace[Math.min(cursor, trace.length - 1)];
    zPlane.update(pointsForSnapshot(snap));

    // Frequency response of the live system vs the target (ghost).
    const liveMag = magOnHalfCircle(toModalSystem(snap.state));
    bodePlot.update(
      { theta: freqTheta, magnitude: liveMag },
      { theta: freqTheta, magnitude: targetMag },
    );

    // Loss curve up through the cursor + ghost-trailing.
    const lossSeen: number[] = trace.slice(0, cursor + 1).map((s) => s.loss);
    const lossAll: number[] = trace.map((s) => s.loss);

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
    // Pre-compute target frequency response + a sensible y-axis ceiling
    // (~1.4× the target's peak, padded out so the live response can briefly
    // overshoot during training without clipping).
    const targetSys = toModalSystem({ modes: target.modes });
    targetMag = magOnHalfCircle(targetSys);
    freqTheta = Array.from({ length: N_FREQ }, (_, i) => (Math.PI * i) / (N_FREQ - 1));
    const peak = Math.max(1, ...targetMag);
    bodeYMax = Math.pow(10, Math.ceil(Math.log10(peak * 2)));

    zPlane = new ZPlane(zSvg, {});
    lossPlot = new TimeSeries(lossSvg, {
      xLabel: 'training time τ (snapshot index)',
      yLabel: 'loss',
      yLog: true,
    });
    bodePlot = new BodePlot(bodeSvg, {
      yMin: 0.05,
      yMax: bodeYMax,
      yLog: true,
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
  <div class="widget-row widget-row--top">
    <div class="widget-panel widget-panel--zplane">
      <div class="widget-panel-header">z-plane — poles (×) &amp; zeros (○)</div>
      <svg bind:this={zSvg}></svg>
    </div>
    <div class="widget-panel widget-panel--bode">
      <div class="widget-panel-header">
        |H(e<sup>iθ</sup>)| &nbsp; — &nbsp;
        <span class="legend-swatch legend-swatch--target"></span> target
        &nbsp;
        <span class="legend-swatch legend-swatch--live"></span> learned
      </div>
      <svg bind:this={bodeSvg}></svg>
    </div>
  </div>

  <div class="widget-panel widget-panel--loss">
    <div class="widget-panel-header">loss L(τ)</div>
    <svg bind:this={lossSvg}></svg>
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
      plane — and one new <em>peak</em> appearing in |H(e<sup>iθ</sup>)|.
      Scrub the slider to watch the network learn one frequency at a time:
      every cliff is the network "discovering" the next mode of the
      target, visible as the solid learned curve rising to meet the
      dashed target at a new resonance.
    </p>
  </div>
</div>

<style>
  .widget--staircase {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    /* Keep the widget within its widget-l-page slot but cap so it never
       extends past the article container at any viewport. */
    max-width: 100%;
    overflow: hidden;
  }
  .widget--staircase svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .widget-panel--zplane {
    min-width: 0;
  }
  .widget-panel--bode {
    min-width: 0;
  }
  .widget-panel--loss {
    min-width: 0;
  }
  .widget-panel--loss :global(svg) {
    /* keep loss curve short so it doesn't dominate the layout */
    max-height: 180px;
  }
  .widget-row--top {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: 1fr;
  }
  @media (min-width: 760px) {
    .widget-row--top {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr);
      align-items: start;
    }
  }
  .staircase-controls input[type='range'] {
    width: 100%;
  }
  .staircase-stats {
    font-family: var(--font-mono, JetBrains Mono, monospace);
    font-size: 13px;
    color: var(--text-soft);
    margin-left: auto;
  }
  .widget-panel--bode .widget-panel-header,
  .widget-panel--zplane .widget-panel-header,
  .widget-panel--loss .widget-panel-header {
    font-size: 12.5px;
  }
  .legend-swatch {
    display: inline-block;
    width: 14px;
    height: 2px;
    vertical-align: middle;
    margin: 0 2px 2px 4px;
  }
  .legend-swatch--target {
    border-top: 2px dashed var(--accent-target, #888);
    height: 0;
  }
  .legend-swatch--live {
    background: var(--accent-active, #d1495b);
  }
  .widget--staircase :global(.widget-hint) {
    font-size: 14px;
    line-height: 1.55;
  }
</style>
