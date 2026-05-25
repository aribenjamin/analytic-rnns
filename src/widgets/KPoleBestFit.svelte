<!--
  §7 widget: the plateaus are best-fit degree-k transfer functions.

  Trains a (W, b, c) student on a degree-3 target (default: three real
  poles {0.3, 0.6, 0.9}). "new init" rerolls the target — either three
  random real poles or one real + one complex conjugate pair — and
  recomputes the best-fit-degree-k reference overlays at runtime (search
  over both all-real and complex-pair shapes).
  Three panels:

    1. z-plane — live eigenvalues + trails + ghost target poles + live zeros
    2. |H(e^{iθ})| — learned vs target vs optimal k-pole overlays
    3. loss vs training time (log-log), with horizontal dotted reference
       lines at the Gram-loss optima L*_1, L*_2, L*_3.

  The point: at each plateau the loss curve lands on one of the dotted
  reference lines, and the eigenvalues sit at the Gram-optimal k-pole
  configuration — *not* at any subset of the target's poles.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ZPlane, type ZPlanePoint, type ZPlaneTrail } from '../lib/plots/ZPlane';
  import { TimeSeries, type TimeSeriesTrace } from '../lib/plots/TimeSeries';
  import { BodePlot, type BodeOverlay } from '../lib/plots/BodePlot';
  import {
    toModalSystem,
    impulseResponseOfModes,
    type TraceSnapshot,
    type ModalTarget,
    type Mode,
  } from '../lib/gradientFlow';
  import type { ModalSystem } from '../lib/transferFn';
  import { inputFromKind } from '../lib/rnnTrain';
  import { evalH, zeros as computeZeros } from '../lib/transferFn';
  import { expi, abs as cabs, type Complex } from '../lib/complex';
  import { computeOptimalFits, type OptimalFit } from '../lib/computeOptimalFits';

  const T_HORIZON = 160;
  const TOTAL_DIM = 3;
  const N_FREQ = 256;

  // Deterministic PRNG (mulberry32). Used to draw new random real target
  // poles each time the user clicks "new init".
  function mulberry32(seed: number): () => number {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Default first-paint target: three real poles {0.3, 0.6, 0.9} with unit
  // residues. Matches the published §7 figure. `newRun` rerolls this, and
  // each reroll picks (with equal probability) either three real poles or
  // one real + one complex conjugate pair — both have total degree 3.
  function defaultTargetModes(): Mode[] {
    return [
      { kind: 'real', p: 0.3, alpha: 1, beta: 1 },
      { kind: 'real', p: 0.6, alpha: 1, beta: 1 },
      { kind: 'real', p: 0.9, alpha: 1, beta: 1 },
    ];
  }

  function buildTarget(modes: Mode[]): ModalTarget {
    const gStar = impulseResponseOfModes(modes, T_HORIZON);
    return { modes, gStar, T: T_HORIZON };
  }

  function drawRealPole(rng: () => number, minMag: number, maxMag: number): number {
    const sign = rng() < 0.5 ? -1 : 1;
    return sign * (minMag + (maxMag - minMag) * rng());
  }

  function drawThreeRealModes(rng: () => number): Mode[] {
    const MIN_MAG = 0.25;
    const MAX_MAG = 0.92;
    const MIN_SEP = 0.18;
    while (true) {
      const ps: number[] = [];
      for (let i = 0; i < 3; i++) ps.push(drawRealPole(rng, MIN_MAG, MAX_MAG));
      ps.sort((a, b) => a - b);
      let ok = true;
      for (let i = 1; i < ps.length; i++) {
        if (Math.abs(ps[i] - ps[i - 1]) < MIN_SEP) { ok = false; break; }
      }
      if (ok) return ps.map((p) => ({ kind: 'real' as const, p, alpha: 1, beta: 1 }));
    }
  }

  function drawRealPlusPairModes(rng: () => number): Mode[] {
    const pReal = drawRealPole(rng, 0.25, 0.92);
    // Complex pair: radius in [0.35, 0.92], angle in [π/6, 5π/6] (well off
    // the real axis so it's visually distinct from the real pole).
    const r = 0.35 + (0.92 - 0.35) * rng();
    const theta = Math.PI / 6 + (2 * Math.PI / 3) * rng();
    const p = { re: r * Math.cos(theta), im: r * Math.sin(theta) };
    return [
      { kind: 'real', p: pReal, alpha: 1, beta: 1 },
      { kind: 'pair', p, alpha: { re: 1, im: 0 }, beta: { re: 1, im: 0 } },
    ];
  }

  function drawRandomTargetModes(rng: () => number): Mode[] {
    return rng() < 0.5 ? drawThreeRealModes(rng) : drawRealPlusPairModes(rng);
  }

  let initScaleLog = -2;
  $: initScale = Math.pow(10, initScaleLog);
  let runSeed = 7;

  let inputSeq: number[] = [];
  let yStar: number[] = [];

  const cfg = {
    dt: 2e-3,
    steps: 60000,
    snapshots: 280,
    rhoThreshold: 0.05,
  };

  let target: ModalTarget = buildTarget(defaultTargetModes());
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

  let optimalFits: OptimalFit[] = [];
  let optimalMags: number[][] = [];
  let targetZeros: Complex[] = [];
  let targetSys: ModalSystem = { poles: [], residues: [] };

  function magOfFit(fit: OptimalFit): number[] {
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
        H.re += (r.re * denom.re + r.im * denom.im) / denomMag2;
        H.im += (r.im * denom.re - r.re * denom.im) / denomMag2;
      }
      mags[i] = Math.sqrt(H.re * H.re + H.im * H.im);
    }
    return mags;
  }

  function recomputeTargetDerived(): void {
    targetSys = toModalSystem({ modes: target.modes });
    optimalFits = computeOptimalFits(
      targetSys.poles,
      targetSys.residues,
      target.gStar,
      mulberry32((runSeed * 0x9e37 + 1) | 0),
    );
    optimalMags = optimalFits.map(magOfFit);
    targetZeros = computeZeros(targetSys);
  }
  recomputeTargetDerived();

  const MODE_COLORS = ['#d1495b', '#edae49', '#66a182', '#2e4057'];
  const REF_LINE_COLORS = ['#7aa0c4', '#a59ad6', '#c79ac7'];

  function magOnHalfCircle(sys: { poles: any[]; residues: any[] }): number[] {
    const out = new Array(N_FREQ);
    for (let i = 0; i < N_FREQ; i++) {
      const th = (Math.PI * i) / (N_FREQ - 1);
      out[i] = cabs(evalH(sys as any, expi(th)));
    }
    return out;
  }

  function pointsForSnapshot(snap: TraceSnapshot, k: number): ZPlanePoint[] {
    const pts: ZPlanePoint[] = [];
    // Ghost target poles (conjugate pairs are listed twice in targetSys).
    for (let i = 0; i < targetSys.poles.length; i++) {
      pts.push({ id: `ghost-pole-${i}`, z: targetSys.poles[i], kind: 'ghost-pole', draggable: false });
    }
    // Ghost target zeros
    for (let i = 0; i < targetZeros.length; i++) {
      pts.push({ id: `ghost-zero-${i}`, z: targetZeros[i], kind: 'ghost-zero', draggable: false });
    }
    // Reference markers for the currently-relevant optimal k-pole fit (faded).
    if (k >= 1 && k <= optimalFits.length) {
      const fit = optimalFits[k - 1];
      const refColor = REF_LINE_COLORS[k - 1];
      for (let i = 0; i < fit.poles.length; i++) {
        pts.push({
          id: `ref-pole-k${k}-${i}`,
          z: fit.poles[i],
          kind: 'ghost-pole',
          color: refColor,
          draggable: false,
        });
      }
    }
    // Live eigenvalues (poles)
    for (let i = 0; i < snap.state.modes.length; i++) {
      const m = snap.state.modes[i];
      const color = MODE_COLORS[i % MODE_COLORS.length];
      const poleMag = m.kind === 'real'
        ? Math.abs(m.p as number)
        : Math.hypot((m.p as any).re, (m.p as any).im);
      const active = poleMag > cfg.rhoThreshold;
      const c = active ? color : 'var(--text-faint, #bbb)';
      if (m.kind === 'real') {
        pts.push({ id: `pole-${i}`, z: { re: m.p, im: 0 }, kind: 'pole', color: c, draggable: false });
      } else {
        pts.push({ id: `pole-${i}`, z: m.p, kind: 'pole', color: c, draggable: false });
        pts.push({
          id: `pole-${i}-conj`,
          z: { re: (m.p as any).re, im: -(m.p as any).im },
          kind: 'pole',
          color: c,
          draggable: false,
        });
      }
    }
    // Live zeros — computed from the current modal state.
    const sys = toModalSystem(snap.state);
    const liveZeros = computeZeros(sys);
    for (let i = 0; i < liveZeros.length; i++) {
      pts.push({ id: `zero-${i}`, z: liveZeros[i], kind: 'zero', color: '#555', draggable: false });
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
    return Math.min(k, optimalFits.length);
  }

  function redraw(): void {
    if (!trace.length || !zPlane || !lossPlot || !bodePlot) return;
    const snap = trace[Math.min(cursor, trace.length - 1)];
    const k = activeK(snap);

    zPlane.update(pointsForSnapshot(snap, k));

    // Eigenvalue trails through the trace up to the cursor.
    const trails: ZPlaneTrail[] = [];
    const modeCount = trace[0]?.state.modes.length ?? 0;
    for (let i = 0; i < modeCount; i++) {
      const pts: { re: number; im: number }[] = [];
      const ptsConj: { re: number; im: number }[] = [];
      let isPair = false;
      for (let t = 0; t <= Math.min(cursor, trace.length - 1); t++) {
        const m = trace[t].state.modes[i];
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
        trails.push({ id: `trail-${i}`, points: pts, color: MODE_COLORS[i % MODE_COLORS.length] + '55' });
        if (isPair && ptsConj.length > 1) {
          trails.push({ id: `trail-${i}-conj`, points: ptsConj, color: MODE_COLORS[i % MODE_COLORS.length] + '55' });
        }
      }
    }
    zPlane.setTrails(trails);

    // Bode overlays: show optimal-k overlays for k=1..activeK, highlighted.
    const liveMag = magOnHalfCircle(toModalSystem(snap.state));
    const overlays: BodeOverlay[] = [];
    for (let i = 0; i < Math.min(k, optimalMags.length); i++) {
      const isActive = i === k - 1;
      overlays.push({
        data: { theta: freqTheta, magnitude: optimalMags[i] },
        color: isActive ? '#2e86de' : '#bbb',
        dasharray: '5 4',
        width: isActive ? 2 : 1,
        opacity: isActive ? 0.9 : 0.3,
      });
    }
    bodePlot.update(
      { theta: freqTheta, magnitude: liveMag },
      { theta: freqTheta, magnitude: targetMag },
      overlays,
    );

    // Loss panel: log-x in step number τ, log-y in loss.
    // Show full curve (faint dashed) + traversed portion (solid) + three
    // horizontal dotted reference lines at the Gram-optimum L*_k values.
    const tausAll: number[] = trace.map((s) => Math.max(1, s.tau));
    const lossAll: number[] = trace.map((s) => s.loss);
    const tausSeen = tausAll.slice(0, cursor + 1);
    const lossSeen = lossAll.slice(0, cursor + 1);
    const xMin = tausAll[0];
    const xMax = tausAll[tausAll.length - 1];

    // Reference lines for k where the optimum is meaningfully nonzero. The
    // full-rank (k=n) optimum is essentially 0 (machine-precision), drawing
    // a dotted line at it just wastes vertical space.
    const REF_LINE_THRESHOLD = 1e-10;
    const refLines: TimeSeriesTrace[] = optimalFits
      .filter((fit) => fit.error > REF_LINE_THRESHOLD)
      .map((fit, i) => ({
        id: `ref-k${fit.k}`,
        values: [fit.error, fit.error],
        xValues: [xMin, xMax],
        color: REF_LINE_COLORS[i % REF_LINE_COLORS.length],
        width: 1.2,
        dasharray: '4 4',
      }));

    lossPlot.update([
      ...refLines,
      {
        id: 'loss-all',
        values: lossAll,
        xValues: tausAll,
        color: 'var(--text-faint, #ccc)',
        width: 1,
        dasharray: '2 3',
      },
      {
        id: 'loss-seen',
        values: lossSeen,
        xValues: tausSeen,
        color: 'var(--accent-active, #d1495b)',
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
      playTimer = window.setTimeout(tick, 35);
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
    inputSeq = inputFromKind('impulse', T_HORIZON, runSeed);
    yStar = target.gStar.slice();
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
    const rng = mulberry32(runSeed);
    target = buildTarget(drawRandomTargetModes(rng));
    recomputeTargetDerived();
    startTraining();
  }

  function onInitScaleCommit(): void {
    startTraining();
  }

  onMount(() => {
    zPlane = new ZPlane(zSvg, {});
    lossPlot = new TimeSeries(lossSvg, {
      width: 720,
      height: 200,
      xLabel: 'training time τ',
      yLabel: 'loss',
      xLog: true,
      yLog: true,
      margin: { top: 10, right: 80, bottom: 38, left: 56 },
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

<div class="widget widget--bestfit">
  <div class="widget-banner">Plateaus are best-fit degree-k models</div>

  <div class="widget-row widget-row--top">
    <div class="widget-panel widget-panel--zplane">
      <div class="widget-panel-header">z-plane — poles (×) and zeros (○); pale stars: optimal k-pole fit</div>
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
      loss L(τ) — log–log; dotted lines are Gram-loss optima L<sup>*</sup><sub>k</sub>
      {#if !loading}
        &nbsp;·&nbsp; {kLabel} active pole{kLabel !== 1 ? 's' : ''}
      {/if}
    </div>
    <svg bind:this={lossSvg}></svg>
  </div>

  <div class="widget-controls bestfit-controls">
    <div class="widget-btn-row">
      <button class="widget-btn" on:click={playing ? pause : play} disabled={loading || !trace.length}>
        {playing ? 'pause' : 'play'}
      </button>
      <button class="widget-btn" on:click={restart} disabled={loading || !trace.length}>restart</button>
      <button class="widget-btn" on:click={newRun} disabled={loading}>new init</button>
      <span class="bestfit-stats">
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
  </div>
</div>

<style>
  .widget--bestfit {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    max-width: 100%;
    overflow: hidden;
  }
  .widget--bestfit svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .widget-panel--zplane,
  .widget-panel--bode,
  .widget-panel--loss { min-width: 0; }
  .widget-panel--loss :global(svg) { max-height: 220px; }
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
  .bestfit-controls input[type='range'] { width: 100%; }
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
  .bestfit-stats {
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
