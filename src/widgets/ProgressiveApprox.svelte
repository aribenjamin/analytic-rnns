<!--
  §6 widget: progressive k-pole rational approximation.

  Trains a (W, b, c) student on a FIXED target (3 modes / 4-dim) and shows:
    1. z-plane with live eigenvalues + ghost target poles
    2. |H(e^{iθ})| with precomputed optimal k-pole overlays
    3. Loss curve with "k active" labels

  The input-type toggle demonstrates data-dependent gating: switching from
  white noise to lowpass/highpass gates modes at unexcited frequencies.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ZPlane, type ZPlanePoint, type ZPlaneTrail } from '../lib/plots/ZPlane';
  import { TimeSeries } from '../lib/plots/TimeSeries';
  import { BodePlot, type BodeOverlay } from '../lib/plots/BodePlot';
  import {
    toModalSystem,
    impulseResponse,
    type TraceSnapshot,
    type ModalTarget,
    type Mode,
  } from '../lib/gradientFlow';
  import {
    totalDimOfModes,
    inputFromKind,
    convolveCausal,
    type InputKind,
  } from '../lib/rnnTrain';
  import { impulseResponseOfModes } from '../lib/gradientFlow';
  import { evalH, zeros as computeZeros, type ModalSystem } from '../lib/transferFn';
  import { expi, abs as cabs } from '../lib/complex';
  import { OPTIMAL_FITS, FIXED_TARGET_POLES, FIXED_TARGET_RESIDUES } from '../lib/optimalFits';

  const T_HORIZON = 160;
  const TOTAL_DIM = 4;
  const N_FREQ = 256;

  // Fixed target: 3 modes (real 0.85, complex pair 0.65e^{iπ/3}, real -0.5)
  const fixedModes: Mode[] = [
    { kind: 'real', p: 0.85, alpha: Math.sqrt(1.2), beta: Math.sqrt(1.2) },
    {
      kind: 'pair',
      p: { re: 0.325, im: 0.5629165125 },
      alpha: { re: Math.sqrt(0.8) * Math.cos(Math.PI / 12), im: Math.sqrt(0.8) * Math.sin(Math.PI / 12) },
      beta: { re: Math.sqrt(0.8) * Math.cos(Math.PI / 12), im: Math.sqrt(0.8) * Math.sin(Math.PI / 12) },
    },
    { kind: 'real', p: -0.5, alpha: Math.sqrt(0.6), beta: Math.sqrt(0.6) },
  ];

  function buildTarget(): ModalTarget {
    const gStar = impulseResponseOfModes(fixedModes, T_HORIZON);
    return { modes: fixedModes, gStar, T: T_HORIZON };
  }

  let initScaleLog = -2.5;
  $: initScale = Math.pow(10, initScaleLog);
  let runSeed = 42;
  let inputKind: InputKind = 'white';

  let inputSeq: number[] = [];
  let yStar: number[] = [];

  const cfg = {
    dt: 2e-3,
    steps: 30000,
    snapshots: 240,
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
  let lossSvg: SVGSVGElement;
  let bodeSvg: SVGSVGElement;
  let zPlane: ZPlane | null = null;
  let lossPlot: TimeSeries | null = null;
  let bodePlot: BodePlot | null = null;

  let freqTheta: number[] = [];
  let targetMag: number[] = [];

  // Precompute frequency responses for optimal k-pole fits
  const optimalMags: number[][] = OPTIMAL_FITS.map((fit) => {
    const mags = new Array<number>(N_FREQ);
    for (let i = 0; i < N_FREQ; i++) {
      const th = (Math.PI * i) / (N_FREQ - 1);
      const z = expi(th);
      let H = { re: 0, im: 0 };
      for (let j = 0; j < fit.poles.length; j++) {
        const p = fit.poles[j];
        const r = fit.residues[j];
        const denom = { re: z.re - p.re, im: z.im - p.im };
        const denomMag2 = denom.re * denom.re + denom.im * denom.im;
        if (denomMag2 < 1e-30) continue;
        const q = {
          re: (r.re * denom.re + r.im * denom.im) / denomMag2,
          im: (r.im * denom.re - r.re * denom.im) / denomMag2,
        };
        H.re += q.re;
        H.im += q.im;
      }
      mags[i] = Math.sqrt(H.re * H.re + H.im * H.im);
    }
    return mags;
  });

  // Precompute target zeros for ghost markers
  const targetZeros = computeZeros({ poles: FIXED_TARGET_POLES, residues: FIXED_TARGET_RESIDUES });

  const OVERLAY_COLORS = ['#888', '#aaa', '#ccc', '#ddd'];
  const MODE_COLORS = ['#d1495b', '#edae49', '#66a182', '#2e4057'];

  function magOnHalfCircle(sys: { poles: any[]; residues: any[] }): number[] {
    const out = new Array(N_FREQ);
    for (let i = 0; i < N_FREQ; i++) {
      const th = (Math.PI * i) / (N_FREQ - 1);
      out[i] = cabs(evalH(sys as any, expi(th)));
    }
    return out;
  }

  function pointsForSnapshot(snap: TraceSnapshot): ZPlanePoint[] {
    const pts: ZPlanePoint[] = [];
    // Ghost target poles
    for (let k = 0; k < FIXED_TARGET_POLES.length; k++) {
      const p = FIXED_TARGET_POLES[k];
      pts.push({ id: `ghost-pole-${k}`, z: p, kind: 'ghost-pole', draggable: false });
    }
    // Ghost target zeros
    for (let k = 0; k < targetZeros.length; k++) {
      pts.push({ id: `ghost-zero-${k}`, z: targetZeros[k], kind: 'ghost-zero', draggable: false });
    }
    // Live eigenvalues (poles)
    for (let k = 0; k < snap.state.modes.length; k++) {
      const m = snap.state.modes[k];
      const color = MODE_COLORS[k % MODE_COLORS.length];
      const poleMag = m.kind === 'real'
        ? Math.abs(m.p as number)
        : Math.hypot((m.p as any).re, (m.p as any).im);
      const active = poleMag > cfg.rhoThreshold;
      const c = active ? color : 'var(--text-faint, #bbb)';
      if (m.kind === 'real') {
        pts.push({ id: `pole-${k}`, z: { re: m.p, im: 0 }, kind: 'pole', color: c, draggable: false });
      } else {
        pts.push({ id: `pole-${k}`, z: m.p, kind: 'pole', color: c, draggable: false });
        pts.push({
          id: `pole-${k}-conj`,
          z: { re: (m.p as any).re, im: -(m.p as any).im },
          kind: 'pole',
          color: c,
          draggable: false,
        });
      }
    }
    // Live zeros — computed from the current modal state
    const sys = toModalSystem(snap.state);
    const liveZeros = computeZeros(sys);
    for (let k = 0; k < liveZeros.length; k++) {
      pts.push({ id: `zero-${k}`, z: liveZeros[k], kind: 'zero', color: '#555', draggable: false });
    }
    return pts;
  }

  function activeK(snap: TraceSnapshot): number {
    let k = 0;
    for (const m of snap.state.modes) {
      const poleMag = m.kind === 'real'
        ? Math.abs(m.p as number)
        : Math.hypot((m.p as any).re, (m.p as any).im);
      if (poleMag > cfg.rhoThreshold) k += m.kind === 'real' ? 1 : 2;
    }
    return k;
  }

  function redraw(): void {
    if (!trace.length || !zPlane || !lossPlot || !bodePlot) return;
    const snap = trace[Math.min(cursor, trace.length - 1)];
    zPlane.update(pointsForSnapshot(snap));

    // Build eigenvalue trails from trace history up to cursor
    const trails: ZPlaneTrail[] = [];
    const modeCount = trace[0]?.state.modes.length ?? 0;
    for (let k = 0; k < modeCount; k++) {
      const pts: { re: number; im: number }[] = [];
      const ptsConj: { re: number; im: number }[] = [];
      let isPair = false;
      for (let t = 0; t <= Math.min(cursor, trace.length - 1); t++) {
        const m = trace[t].state.modes[k];
        if (!m) continue;
        if (m.kind === 'real') {
          pts.push({ re: m.p, im: 0 });
        } else {
          isPair = true;
          pts.push(m.p as { re: number; im: number });
          ptsConj.push({ re: (m.p as any).re, im: -(m.p as any).im });
        }
      }
      if (pts.length > 1) {
        trails.push({
          id: `trail-${k}`,
          points: pts,
          color: MODE_COLORS[k % MODE_COLORS.length] + '55',
        });
        if (isPair && ptsConj.length > 1) {
          trails.push({
            id: `trail-${k}-conj`,
            points: ptsConj,
            color: MODE_COLORS[k % MODE_COLORS.length] + '55',
          });
        }
      }
    }
    zPlane.setTrails(trails);

    const liveMag = magOnHalfCircle(toModalSystem(snap.state));
    const k = activeK(snap);

    // Show optimal overlays up to active k
    const overlays: BodeOverlay[] = [];
    for (let i = 0; i < Math.min(k, optimalMags.length); i++) {
      const isActive = i === k - 1;
      overlays.push({
        data: { theta: freqTheta, magnitude: optimalMags[i] },
        color: isActive ? '#2e86de' : '#bbb',
        dasharray: '5 4',
        width: isActive ? 2 : 1,
        opacity: isActive ? 0.85 : 0.3,
      });
    }

    bodePlot.update(
      { theta: freqTheta, magnitude: liveMag },
      { theta: freqTheta, magnitude: targetMag },
      overlays,
    );

    // Loss curve
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

  function rebuildInputAndTarget(): void {
    inputSeq = inputFromKind(inputKind, T_HORIZON, runSeed);
    yStar = inputKind === 'impulse' ? target.gStar.slice() : convolveCausal(target.gStar, inputSeq);
  }

  function rebuildBodePlot(): void {
    const targetSys = toModalSystem({ modes: target.modes });
    targetMag = magOnHalfCircle(targetSys);
    freqTheta = Array.from({ length: N_FREQ }, (_, i) => (Math.PI * i) / (N_FREQ - 1));
    const peak = Math.max(1, ...targetMag);
    const bodeYMax = Math.pow(10, Math.ceil(Math.log10(peak * 2)));
    bodeSvg.replaceChildren();
    bodePlot = new BodePlot(bodeSvg, { yMin: 0.05, yMax: bodeYMax, yLog: true });
  }

  function startTraining(): void {
    pause();
    worker?.terminate();
    rebuildInputAndTarget();
    rebuildBodePlot();
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
        input: inputSeq,
        yStar,
      },
    });
  }

  function newRun(): void {
    runSeed = (runSeed + 1) | 0;
    startTraining();
  }

  function onInitScaleCommit(): void {
    startTraining();
  }

  function setInputKind(k: InputKind): void {
    if (k === inputKind) return;
    inputKind = k;
    startTraining();
  }

  const INPUT_KIND_OPTIONS: { id: InputKind; label: string }[] = [
    { id: 'impulse', label: 'impulse' },
    { id: 'white', label: 'white' },
    { id: 'lowpass', label: 'lowpass' },
    { id: 'highpass', label: 'highpass' },
  ];

  onMount(() => {
    zPlane = new ZPlane(zSvg, {});
    lossPlot = new TimeSeries(lossSvg, {
      width: 340,
      height: 170,
      xLabel: 'training time τ',
      yLabel: 'loss',
      yLog: true,
      margin: { top: 6, right: 14, bottom: 38, left: 52 },
      labelFontSize: 12,
    });
    startTraining();
  });

  onDestroy(() => {
    pause();
    worker?.terminate();
  });

  $: tauLabel = trace[cursor]?.tau ?? 0;
  $: lossLabel = trace[cursor]?.loss ?? 0;
  $: kLabel = trace.length ? activeK(trace[Math.min(cursor, trace.length - 1)]) : 0;
</script>

<div class="widget widget--approx">
  <div class="widget-banner">Progressive k-pole approximation</div>

  <div class="widget-row widget-row--top">
    <div class="widget-panel widget-panel--zplane">
      <div class="widget-panel-header">z-plane — poles (×) and zeros (○)</div>
      <svg bind:this={zSvg}></svg>
    </div>
    <div class="widget-panel widget-panel--bode">
      <div class="widget-panel-header">
        |H(e<sup>iθ</sup>)| &nbsp;—&nbsp;
        <span class="legend-swatch legend-swatch--target"></span>target&nbsp;
        <span class="legend-swatch legend-swatch--live"></span>learned&nbsp;
        <span class="legend-swatch legend-swatch--optimal"></span>optimal {kLabel}-pole
      </div>
      <svg bind:this={bodeSvg}></svg>
    </div>
  </div>

  <div class="widget-panel widget-panel--loss">
    <div class="widget-panel-header">
      loss L(τ)
      {#if !loading}
        &nbsp;·&nbsp; {kLabel} active pole{kLabel !== 1 ? 's' : ''}
      {/if}
    </div>
    <svg bind:this={lossSvg}></svg>
  </div>

  <div class="widget-controls approx-controls">
    <div class="widget-btn-row">
      <button class="widget-btn" on:click={playing ? pause : play} disabled={loading || !trace.length}>
        {playing ? 'pause' : 'play'}
      </button>
      <button class="widget-btn" on:click={restart} disabled={loading || !trace.length}>restart</button>
      <button class="widget-btn" on:click={newRun} disabled={loading}>new init</button>
      <span class="approx-stats">
        {#if loading}
          training…
        {:else}
          τ = {tauLabel} &nbsp;·&nbsp; L = {lossLabel.toExponential(2)}
        {/if}
      </span>
    </div>
    <div class="slider-row">
      <label class="slider-cell">
        <span class="slider-cell-label">training time τ</span>
        <input type="range" min="0" max={Math.max(1, trace.length - 1)} value={cursor} on:input={onScrub} disabled={loading || !trace.length} />
      </label>
      <label class="slider-cell">
        <span class="slider-cell-label">init scale σ₀ = {initScale.toExponential(1)}</span>
        <input type="range" min={-4} max={-1} step={0.25} bind:value={initScaleLog} on:change={onInitScaleCommit} disabled={loading} />
      </label>
    </div>
    <div class="input-kind-row">
      <span class="input-kind-label">input&nbsp;</span>
      <div class="seg" role="radiogroup" aria-label="training input">
        {#each INPUT_KIND_OPTIONS as opt}
          <button
            type="button"
            class="seg-btn"
            class:seg-btn--active={inputKind === opt.id}
            on:click={() => setInputKind(opt.id)}
            disabled={loading}
            role="radio"
            aria-checked={inputKind === opt.id}
          >{opt.label}</button>
        {/each}
      </div>
    </div>
  </div>
</div>

<style>
  .widget--approx {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 100%;
    overflow: hidden;
  }
  .widget--approx svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .widget-panel--zplane { min-width: 0; }
  .widget-panel--bode { min-width: 0; }
  .widget-panel--loss { min-width: 0; }
  .widget-panel--loss :global(svg) { max-height: 170px; }
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
  .approx-controls input[type='range'] { width: 100%; }
  .slider-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
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
  @media (max-width: 720px) {
    .slider-row { grid-template-columns: 1fr; }
  }
  .input-kind-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 0.85rem;
    flex-wrap: wrap;
  }
  .seg {
    display: inline-flex;
    border: 1px solid var(--text-faint, #bbb);
    border-radius: 4px;
    overflow: hidden;
  }
  .seg-btn {
    appearance: none;
    background: transparent;
    border: 0;
    padding: 4px 10px;
    font: inherit;
    cursor: pointer;
    color: var(--text-soft, #555);
    border-right: 1px solid var(--text-faint, #bbb);
  }
  .seg-btn:last-child { border-right: 0; }
  .seg-btn:hover:not(:disabled) { background: var(--surface-soft, #f3f3f3); }
  .seg-btn--active { background: var(--accent-active, #d1495b); color: white; }
  .seg-btn--active:hover:not(:disabled) { background: var(--accent-active, #d1495b); }
  .seg-btn:disabled { opacity: 0.5; cursor: default; }
  .approx-stats {
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
    background: var(--accent-target, #888);
    opacity: 0.7;
  }
  .legend-swatch--live {
    background: var(--accent-active, #d1495b);
  }
  .legend-swatch--optimal {
    background: #2e86de;
    height: 1px;
    border-top: 1px dashed #2e86de;
    background: transparent;
  }
</style>
