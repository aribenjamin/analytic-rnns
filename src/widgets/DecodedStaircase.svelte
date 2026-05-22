<!--
  §7 / Figure 5: the decoded staircase — direct (W, b, c) training.

  Trains a small linear SISO RNN parameterised by (W, b, c) via BPTT on a
  multi-frequency impulse-response target. Each run picks a fresh random
  target (random poles + random residue magnitudes) and a fresh random
  small-Gaussian initialisation of W, b, c; the slider sets the init
  scale σ₀.

  Pedagogically, the change from the Phase-A modal-coordinate version is
  that the eigenvalues of W *drift* during training rather than sitting
  at the target poles. The "each cliff is one pole–zero pair separating"
  picture survives but is no longer guaranteed — it's now an empirical
  observation about typical training runs.

  Four synced panels:

    1.  z-plane — live eigenvalues of W (colored by mode), with ghost
        target markers.
    2.  |H(e^{iθ})| — frequency response of the live system vs target.
    3.  Time-domain error e(t) = g(t) − g*(t).
    4.  Loss curve (log y) — the staircase.

  Training runs in a Web Worker; the scrubber lets the reader step
  through recorded snapshots. The "new run" button reseeds both the
  target and the init.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ZPlane, type ZPlanePoint } from '../lib/plots/ZPlane';
  import { TimeSeries } from '../lib/plots/TimeSeries';
  import { BodePlot } from '../lib/plots/BodePlot';
  import {
    toModalSystem,
    impulseResponse,
    type TraceSnapshot,
    type ModalTarget,
  } from '../lib/gradientFlow';
  import {
    randomTarget,
    totalDimOfModes,
    inputFromKind,
    convolveCausal,
    type InputKind,
  } from '../lib/rnnTrain';
  import { zeros as zerosOfSystem, evalH } from '../lib/transferFn';
  import { expi, abs as cabs } from '../lib/complex';

  const T_HORIZON = 160;
  const TOTAL_DIM = 4;

  // Reactive controls
  let initScaleLog = -2.5;
  $: initScale = Math.pow(10, initScaleLog);
  let runSeed = 0;
  let inputKind: InputKind = 'white';

  // Input + target response. Rebuilt by rebuildInputAndTarget(); kept here
  // so the IO panel and the worker share the same arrays.
  let inputSeq: number[] = [];
  let yStar: number[] = [];

  // The training config — fixed; only target, initScale, and seed change per
  // run. Hand-tuned in the Phase-A modal version for a clean 30 k-step
  // staircase; the same step count works for direct (W,b,c) at small init.
  const cfg = {
    dt: 2e-3,
    steps: 30000,
    snapshots: 240,
    rhoThreshold: 0.1,
  };

  let target: ModalTarget = randomTarget({ totalDim: TOTAL_DIM, T: T_HORIZON, seed: runSeed });

  let trace: TraceSnapshot[] = [];
  let cursor = 0;
  let playing = false;
  let playTimer: number | null = null;
  let worker: Worker | null = null;
  let loading = true;

  let zSvg: SVGSVGElement;
  let lossSvg: SVGSVGElement;
  let bodeSvg: SVGSVGElement;
  let inputSvg: SVGSVGElement;
  let outputSvg: SVGSVGElement;
  let errSvg: SVGSVGElement;
  let zPlane: ZPlane | null = null;
  let lossPlot: TimeSeries | null = null;
  let bodePlot: BodePlot | null = null;
  let inputPlot: TimeSeries | null = null;
  let outputPlot: TimeSeries | null = null;
  let errPlot: TimeSeries | null = null;

  const N_FREQ = 256;
  let targetMag: number[] = [];
  let freqTheta: number[] = [];

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

    const liveSys = toModalSystem(snap.state);
    const liveZeros = zerosOfSystem(liveSys);
    liveZeros.forEach((z, i) =>
      pts.push({ id: `zero-${i}`, z, kind: 'zero', draggable: false }),
    );
    return pts;
  }

  function redraw(): void {
    if (!trace.length || !zPlane || !lossPlot || !bodePlot) return;
    const snap = trace[Math.min(cursor, trace.length - 1)];
    zPlane.update(pointsForSnapshot(snap));

    const liveMag = magOnHalfCircle(toModalSystem(snap.state));
    bodePlot.update(
      { theta: freqTheta, magnitude: liveMag },
      { theta: freqTheta, magnitude: targetMag },
    );

    const gLive = impulseResponse(snap.state, T_HORIZON);
    const yLive = inputKind === 'impulse' ? gLive : convolveCausal(gLive, inputSeq);
    const zero = new Array(T_HORIZON).fill(0);

    inputPlot?.update([
      { id: 'zero', values: zero, color: 'var(--text-faint, #ccc)', style: 'line', width: 1 },
      {
        id: 'input',
        values: inputSeq,
        color: 'var(--text, #333)',
        style: inputKind === 'impulse' ? 'stem' : 'line',
        width: 1.2,
      },
    ]);

    outputPlot?.update([
      { id: 'zero', values: zero, color: 'var(--text-faint, #ccc)', style: 'line', width: 1 },
      {
        id: 'target',
        values: yStar,
        color: 'var(--accent-target, #888)',
        style: 'line',
        width: 1.5,
        dasharray: '4 3',
      },
      {
        id: 'output',
        values: yLive,
        color: 'var(--accent-active, #d1495b)',
        style: 'line',
        width: 2,
      },
    ]);

    errPlot?.update([
      { id: 'zero', values: zero, color: 'var(--text-faint, #ccc)', style: 'line', width: 1 },
      {
        id: 'error',
        values: yLive.map((v, t) => v - yStar[t]),
        color: 'var(--accent-active, #d1495b)',
        style: 'line',
        width: 2,
      },
    ]);

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

  function rebuildBodeAndErrPlots(): void {
    const targetSys = toModalSystem({ modes: target.modes });
    targetMag = magOnHalfCircle(targetSys);
    freqTheta = Array.from({ length: N_FREQ }, (_, i) => (Math.PI * i) / (N_FREQ - 1));
    const peak = Math.max(1, ...targetMag);
    const bodeYMax = Math.pow(10, Math.ceil(Math.log10(peak * 2)));

    // Both BodePlot and TimeSeries fix their y-range at construction, so
    // recreate them when the target or input changes.
    bodeSvg.replaceChildren();
    bodePlot = new BodePlot(bodeSvg, { yMin: 0.05, yMax: bodeYMax, yLog: true });

    const PANEL_W = 560;
    const TOP_M = 14;
    const MID_M = 2;
    const BOT_M = 36;
    const LEFT_M = 14;
    const RIGHT_M = 14;
    const LABEL_FS = 12;

    const inputYAbs = 1.1 * Math.max(1e-3, ...inputSeq.map(Math.abs));
    inputSvg.replaceChildren();
    inputPlot = new TimeSeries(inputSvg, {
      width: PANEL_W,
      height: 60,
      xLabel: '',
      yLabelParts: [{ text: 'input u(t)', color: 'var(--text, #333)' }],
      yLabelHorizontal: true,
      yMin: -inputYAbs,
      yMax: inputYAbs,
      hideXTicks: true,
      hideYTicks: true,
      margin: { top: TOP_M, right: RIGHT_M, bottom: MID_M, left: LEFT_M },
      labelFontSize: LABEL_FS,
    });

    const outputYAbs = 1.1 * Math.max(1e-3, ...yStar.map(Math.abs));
    outputSvg.replaceChildren();
    outputPlot = new TimeSeries(outputSvg, {
      width: PANEL_W,
      height: 86,
      xLabel: '',
      yLabelParts: [
        { text: 'y(t)', color: 'var(--accent-active, #d1495b)' },
        { text: ',  ', color: '#555' },
        { text: 'y*(t)', color: 'var(--accent-target, #888)' },
      ],
      yLabelHorizontal: true,
      yMin: -outputYAbs,
      yMax: outputYAbs,
      hideXTicks: true,
      hideYTicks: true,
      margin: { top: TOP_M, right: RIGHT_M, bottom: MID_M, left: LEFT_M },
      labelFontSize: LABEL_FS,
    });

    const errYAbs = 1.1 * Math.max(1e-6, ...yStar.map(Math.abs));
    errSvg.replaceChildren();
    errPlot = new TimeSeries(errSvg, {
      width: PANEL_W,
      height: 84,
      xLabel: 'response time t',
      yLabelParts: [{ text: 'error', color: 'var(--accent-active, #d1495b)' }],
      yLabelHorizontal: true,
      yMin: -errYAbs,
      yMax: errYAbs,
      hideYTicks: true,
      margin: { top: TOP_M, right: RIGHT_M, bottom: BOT_M, left: LEFT_M },
      labelFontSize: LABEL_FS,
    });
  }

  function startTraining(): void {
    pause();
    worker?.terminate();

    target = randomTarget({ totalDim: TOTAL_DIM, T: T_HORIZON, seed: runSeed });
    rebuildInputAndTarget();
    rebuildBodeAndErrPlots();

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
        n: totalDimOfModes(target.modes),
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
    // Same init + target; only the input (and thus yStar) change.
    startTraining();
  }

  const INPUT_KIND_OPTIONS: { id: InputKind; label: string }[] = [
    { id: 'impulse', label: 'impulse δ(t)' },
    { id: 'white', label: 'white noise' },
    { id: 'pink', label: '1/f noise' },
  ];

  onMount(() => {
    zPlane = new ZPlane(zSvg, {});
    lossPlot = new TimeSeries(lossSvg, {
      width: 560,
      height: 130,
      xLabel: 'training time τ (snapshot index)',
      yLabel: 'loss',
      yLog: true,
      margin: { top: 6, right: 14, bottom: 40, left: 56 },
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
  $: rhoLabel = trace[cursor]?.rho ?? 0;
</script>

<div class="widget widget--staircase">
<div class="widget-banner">Watching actual learning dynamics</div>

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

  <div class="widget-panel widget-panel--io-stack">
    <div class="widget-panel-header">
      {#if inputKind === 'impulse'}
        impulse response
      {:else if inputKind === 'white'}
        response to white-noise input
      {:else}
        response to 1/f-noise input
      {/if}
    </div>
    <svg class="io-row io-row--input" bind:this={inputSvg}></svg>
    <svg class="io-row io-row--output" bind:this={outputSvg}></svg>
    <svg class="io-row io-row--error" bind:this={errSvg}></svg>
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
      <button class="widget-btn" on:click={newRun} disabled={loading}>random init & target</button>
      <span class="staircase-stats">
        {#if loading}
          training…
        {:else}
          τ = {tauLabel} &nbsp;·&nbsp; L = {lossLabel.toExponential(2)} &nbsp;·&nbsp; ρ = {rhoLabel}
        {/if}
      </span>
    </div>
    <div class="slider-row">
      <label class="slider-cell">
        <span class="slider-cell-label">training time τ</span>
        <input
          type="range"
          min="0"
          max={Math.max(1, trace.length - 1)}
          value={cursor}
          on:input={onScrub}
          disabled={loading || !trace.length}
        />
      </label>
      <label class="slider-cell">
        <span class="slider-cell-label">init scale σ₀ = {initScale.toExponential(1)}</span>
        <input
          type="range"
          min={-4}
          max={-1}
          step={0.25}
          bind:value={initScaleLog}
          on:change={onInitScaleCommit}
          disabled={loading}
        />
      </label>
    </div>
    <div class="input-kind-row">
      <span class="input-kind-label">training input&nbsp;</span>
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
    <p class="widget-hint">
      The student is parameterised in raw (W, b, c) coordinates — every entry
      Gaussian-random at scale σ₀. "Random init &amp; target" reseeds both the
      target system and the init; the input-type toggle keeps both fixed and
      only changes what u(t) the trainer sees. Compare what shape of cliffs
      (or none) different input statistics carve out of the loss curve.
    </p>
  </div>
</div>

<style>
  .widget--staircase {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
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
  .widget-panel--io-stack {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
  }
  .widget-panel--io-stack .io-row {
    width: 100%;
    height: auto;
    display: block;
  }
  .widget-panel--io-stack .io-row--input { max-height: 60px; }
  .widget-panel--io-stack .io-row--output { max-height: 86px; }
  .widget-panel--io-stack .io-row--error { max-height: 84px; }
  .widget-panel--loss :global(svg) {
    max-height: 130px;
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
  .slider-cell input[type='range'] {
    width: 100%;
  }
  .slider-cell-label {
    color: var(--text-soft, #555);
  }
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
  .seg-btn:hover:not(:disabled) {
    background: var(--surface-soft, #f3f3f3);
  }
  .seg-btn--active {
    background: var(--accent-active, #d1495b);
    color: white;
  }
  .seg-btn--active:hover:not(:disabled) {
    background: var(--accent-active, #d1495b);
  }
  .seg-btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .staircase-stats {
    font-family: var(--font-mono, JetBrains Mono, monospace);
    font-size: 13px;
    color: var(--text-soft);
    margin-left: auto;
  }
  .widget-panel--bode .widget-panel-header,
  .widget-panel--zplane .widget-panel-header,
  .widget-panel--io-stack .widget-panel-header,
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
