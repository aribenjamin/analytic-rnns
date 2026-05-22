<!--
  §6 / Figure 4: cancellation is a saddle.

  Show the loss ℒ(α, β) = ½J²/S − αβJ + ½(αβ)²S restricted to the real
  (α, β) slice of one mode's coordinate plane. The saddle at the origin
  pinches contours into a cross; gradient flow plateaus there and then
  escapes along α = β onto the αβ = J/S minimum hyperbola. A live ball
  the reader can launch makes the plateau-then-drop dynamic, with a side
  panel showing L(τ).

  ½J²/S is added as a baseline so the *displayed* loss is positive
  (saddle value = ½J²/S, minimum value = 0). This makes L(τ) look like
  the Saxe staircase rather than crossing through negative values, which
  is the pedagogical analogue we want the reader to draw.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { ContourFlow } from '../lib/plots/ContourFlow';
  import { TimeSeries } from '../lib/plots/TimeSeries';
  import {
    type SaddleParams,
    type SaddleSample,
    saddleLoss,
    saddleGrad,
    integrateSaddle,
  } from '../lib/saddleLoss';

  // Reactive parameters.
  let J = 1.0;
  let S = 1.0;

  $: baseline = 0.5 * J * J / S;
  $: params = { J, S, baseline } satisfies SaddleParams;

  // Plot range. Symmetric around the origin so the saddle sits centred.
  const AXIS = 2.0;

  // Live trajectory (animating ball).
  let liveTraj: SaddleSample[] = [];
  let liveActive = false;
  let rafId = 0;
  const DT = 0.02;
  const STEPS_PER_FRAME = 3;
  const TAU_MAX = 10;
  // Stop early once we're clearly converged (close to a minimum).
  const SETTLE_TOL = 5e-3;

  // Refs.
  let canvasEl: HTMLCanvasElement;
  let landscapeSvg: SVGSVGElement;
  let tsSvg: SVGSVGElement;
  let errSvg: SVGSVGElement;
  let cf: ContourFlow | null = null;
  let ts: TimeSeries | null = null;
  let terr: TimeSeries | null = null;

  // Time-domain error: pretend target and learned share a fixed pole p_imp.
  // Target impulse response y*(t) = r*·p^t with r* = J/S (the minimum value
  // of αβ). Learned ŷ(t) = (αβ)·p^t. The error e(t) = (r* − αβ)·p^t shrinks
  // to zero exactly when the ball reaches the αβ = J/S minimum hyperbola.
  const P_IMP = 0.7;
  const T_IMP = 40;
  const IMP_POW: number[] = (() => {
    const a = new Array<number>(T_IMP);
    let v = 1;
    for (let t = 0; t < T_IMP; t++) { a[t] = v; v *= P_IMP; }
    return a;
  })();

  function errorSeries(alpha: number, beta: number): number[] {
    const rStar = J / S;
    const gapNorm = rStar === 0 ? 0 : (rStar - alpha * beta) / rStar;
    const out = new Array<number>(T_IMP);
    for (let t = 0; t < T_IMP; t++) out[t] = gapNorm * IMP_POW[t];
    return out;
  }

  // Read-outs.
  $: currentAlpha = liveTraj.length ? liveTraj[liveTraj.length - 1].alpha : 0;
  $: currentBeta = liveTraj.length ? liveTraj[liveTraj.length - 1].beta : 0;
  $: currentR = currentAlpha * currentBeta;
  $: currentL = liveTraj.length ? liveTraj[liveTraj.length - 1].L : baseline;

  function lossAt(x: number, y: number): number {
    return saddleLoss(x, y, params);
  }

  // ── trajectory ring ───────────────────────────────────────────────────
  // Pre-bake 8 faint background trajectories from a small ring around the
  // origin, skewed off the α = ±β axes so each one visibly escapes (a ball
  // started exactly on the stable line would sit there forever).
  function bakeRingTraces(): { id: string; points: { x: number; y: number }[] }[] {
    const N = 8;
    const r = 0.05;
    const out: { id: string; points: { x: number; y: number }[] }[] = [];
    for (let i = 0; i < N; i++) {
      const theta = (Math.PI / 8) + (i * Math.PI) / 4;
      const a0 = r * Math.cos(theta);
      const b0 = r * Math.sin(theta);
      const traj = integrateSaddle(a0, b0, params, DT, 600);
      out.push({
        id: `ring-${i}`,
        points: traj.map((p) => ({ x: p.alpha, y: p.beta })),
      });
    }
    return out;
  }

  function ringTracesForCF() {
    return bakeRingTraces().map((t) => ({
      ...t,
      color: 'var(--text-muted)',
      width: 1.2,
      opacity: 0.42,
    }));
  }

  // ── live ball ────────────────────────────────────────────────────────
  function updateErr(alpha: number, beta: number): void {
    if (!terr) return;
    terr.update([
      {
        id: 'zero',
        values: new Array(T_IMP).fill(0),
        color: 'var(--text-faint)',
        style: 'line',
        width: 1,
        dasharray: '4 3',
      },
      {
        id: 'err',
        values: errorSeries(alpha, beta),
        color: 'var(--accent-pole)',
        style: 'line',
        width: 2,
      },
    ]);
  }

  function stopLive(): void {
    liveActive = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function startLive(a0: number, b0: number): void {
    stopLive();
    liveTraj = [{ tau: 0, alpha: a0, beta: b0, L: lossAt(a0, b0) }];
    liveActive = true;
    rafId = requestAnimationFrame(stepLive);
    cf?.setLiveTrace([{ x: a0, y: b0 }]);
    cf?.setLiveBall({ x: a0, y: b0 });
    updateErr(a0, b0);
    ts?.update([
      {
        id: 'live',
        values: liveTraj.map((p) => p.L),
        color: 'var(--accent-pole)',
        style: 'line',
        width: 2.25,
      },
      {
        id: 'baseline',
        values: new Array(2).fill(baseline),
        color: 'var(--text-faint)',
        style: 'line',
        width: 1,
        dasharray: '4 3',
      },
    ]);
  }

  function stepLive(): void {
    if (!liveActive) return;
    const buf = liveTraj.slice();
    for (let i = 0; i < STEPS_PER_FRAME; i++) {
      const last = buf[buf.length - 1];
      if (last.tau >= TAU_MAX) {
        liveActive = false;
        break;
      }
      const g = saddleGrad(last.alpha, last.beta, params);
      const a = last.alpha - DT * g.dAlpha;
      const b = last.beta - DT * g.dBeta;
      buf.push({ tau: last.tau + DT, alpha: a, beta: b, L: lossAt(a, b) });
      // Converged?
      if (Math.hypot(g.dAlpha, g.dBeta) < SETTLE_TOL && last.tau > 1.0) {
        liveActive = false;
        break;
      }
    }
    liveTraj = buf;
    const head = liveTraj[liveTraj.length - 1];
    cf?.setLiveTrace(liveTraj.map((p) => ({ x: p.alpha, y: p.beta })));
    cf?.setLiveBall({ x: head.alpha, y: head.beta });
    updateErr(head.alpha, head.beta);
    // Pad the dashed baseline reference to the current length so both lines
    // share an x axis.
    const baselineSeries = new Array(liveTraj.length).fill(baseline);
    ts?.update([
      {
        id: 'live',
        values: liveTraj.map((p) => p.L),
        color: 'var(--accent-pole)',
        style: 'line',
        width: 2.25,
      },
      {
        id: 'baseline',
        values: baselineSeries,
        color: 'var(--text-faint)',
        style: 'line',
        width: 1,
        dasharray: '4 3',
      },
    ]);
    if (liveActive) rafId = requestAnimationFrame(stepLive);
  }

  function dropBall(): void {
    // Drop near, but not on, the stable diagonal — pick a random angle
    // outside ±π/16 of α = −β so the ball reliably escapes.
    let theta: number;
    const stableAng = -Math.PI / 4;
    do {
      theta = (Math.random() - 0.5) * 2 * Math.PI;
    } while (
      Math.abs(((theta - stableAng + Math.PI) % (2 * Math.PI)) - Math.PI) < Math.PI / 16
      || Math.abs(((theta - stableAng - Math.PI + Math.PI) % (2 * Math.PI)) - Math.PI) < Math.PI / 16
    );
    const r = 0.04 + 0.04 * Math.random();
    startLive(r * Math.cos(theta), r * Math.sin(theta));
  }

  function onContourClick(x: number, y: number): void {
    startLive(x, y);
  }

  // ── reactive recompute ───────────────────────────────────────────────
  // When J or S change, re-render the surface, re-bake the ring, and
  // recompute current readouts. The live ball, if running, simply keeps
  // integrating against the new params (the gradient flow tracks the
  // current landscape).
  $: if (cf && (J || S)) {
    const ridgeCap = baseline * 4; // clamp colours; ridges grow quartically off-frame.
    cf.setLoss(lossAt, [baseline - 2 * baseline, baseline + ridgeCap]);
    cf.setBakedTraces(ringTracesForCF());
  }

  onMount(() => {
    cf = new ContourFlow(landscapeSvg, canvasEl, {
      width: 500,
      height: 500,
      xMin: -AXIS,
      xMax: AXIS,
      yMin: -AXIS,
      yMax: AXIS,
      loss: lossAt,
      resolution: 180,
      nContours: 20,
      // Diverging map: cool blue below the saddle (the basins), warm red
      // above (the ridges), with neutral cream at the saddle value. We
      // shift the input parameter so the inflection lands at L = baseline.
      colorInterpolator: (t: number) => d3.interpolateRdBu(1 - t),
      colorDomain: [baseline - 2 * baseline, baseline + 4 * baseline],
      onClick: onContourClick,
      xLabel: 'α  (observability)',
      yLabel: 'β  (controllability)',
    });
    cf.setOverlayAxes([
      { id: 'unstable', dx: 1, dy: 1, label: 'α = β  · unstable', kind: 'unstable' },
      { id: 'stable',   dx: 1, dy: -1, label: 'α = −β  · stable',  kind: 'stable' },
    ]);
    cf.setBakedTraces(ringTracesForCF());

    ts = new TimeSeries(tsSvg, {
      width: 460,
      height: 500,
      xLabel: 'training time τ',
      yLabel: 'L(τ)',
      yMin: 0,
      yMax: undefined,
    });
    ts.update([
      {
        id: 'baseline',
        values: new Array(2).fill(baseline),
        color: 'var(--text-faint)',
        style: 'line',
        width: 1,
        dasharray: '4 3',
      },
    ]);

    terr = new TimeSeries(errSvg, {
      width: 460,
      height: 240,
      xLabel: 'time t (impulse response sample)',
      yLabel: 'e(t) / r*  (units of target residue)',
      yMin: -1.4,
      yMax: 1.4,
    });
    updateErr(0, 0);

    // Auto-drop one ball so the widget reads as active on first paint.
    dropBall();
  });

  onDestroy(() => {
    stopLive();
  });
</script>

<div class="widget widget--saddle">
  <div class="widget-row widget-row--saddle">
    <div class="widget-panel widget-panel--landscape">
      <div class="widget-panel-header">loss surface L(α, β)</div>
      <div class="landscape-stage">
        <canvas bind:this={canvasEl}></canvas>
        <svg bind:this={landscapeSvg}></svg>
      </div>
    </div>
    <div class="widget-right-col">
      <div class="widget-panel widget-panel--loss">
        <div class="widget-panel-header">L(τ) — gradient flow of the live ball</div>
        <svg bind:this={tsSvg}></svg>
      </div>
      <div class="widget-panel widget-panel--err">
        <div class="widget-panel-header">e(t) — error from target impulse response</div>
        <svg bind:this={errSvg}></svg>
      </div>
    </div>
  </div>

  <div class="widget-controls widget-controls--strip">
    <div class="control-grid">
      <label class="slider">
        <span class="control-label">J — cross-energy (target strength)</span>
        <input type="range" min="0.1" max="3" step="0.05" bind:value={J} />
        <span class="slider-val">{J.toFixed(2)}</span>
      </label>
      <label class="slider">
        <span class="control-label">S — input mode energy</span>
        <input type="range" min="0.3" max="3" step="0.05" bind:value={S} />
        <span class="slider-val">{S.toFixed(2)}</span>
      </label>
      <div class="actions">
        <button class="widget-btn" on:click={dropBall}>drop a new ball</button>
      </div>
      <div class="readouts">
        <div class="readout">
          <span class="readout-key">α</span>
          <span class="readout-val">{currentAlpha.toFixed(2)}</span>
        </div>
        <div class="readout">
          <span class="readout-key">β</span>
          <span class="readout-val">{currentBeta.toFixed(2)}</span>
        </div>
        <div class="readout">
          <span class="readout-key">|r|</span>
          <span class="readout-val">{Math.abs(currentR).toFixed(2)}</span>
        </div>
        <div class="readout">
          <span class="readout-key">L</span>
          <span class="readout-val">{currentL.toFixed(3)}</span>
        </div>
      </div>
    </div>
    <p class="widget-hint">
      The cross-shaped pinch at the origin is the saddle: the residue
      <code>r = αβ</code> is zero, and the gradient is too. Drop a ball or
      click anywhere on the surface — the trajectory crawls along the saddle's
      plateau before escaping outward along the dashed <code>α = β</code> line
      onto one of the two minimum basins. Move <em>J</em> and the saddle gets
      sharper; move <em>S</em> and the basins migrate inward.
    </p>
  </div>
</div>

<style>
  .widget--saddle .widget-row--saddle {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--space-4);
  }

  @media (min-width: 720px) {
    .widget--saddle .widget-row--saddle {
      grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr);
      align-items: stretch;
    }
  }

  .widget-panel--landscape {
    aspect-ratio: 1 / 1;
    position: relative;
    /* Keep the square panel sized by its grid track. Without min-width: 0 a
       grid item refuses to shrink below its content's intrinsic size; without
       align-self: start a taller right column would stretch this panel and
       aspect-ratio would echo that height back into width, overflowing the
       track and covering the L(τ) / e(t) panels. */
    min-width: 0;
    align-self: start;
  }

  .widget-panel--loss {
    min-height: 240px;
  }

  .widget-panel--err {
    min-height: 200px;
  }

  .widget-right-col {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .widget-panel--err svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .landscape-stage {
    position: relative;
    width: 100%;
    flex: 1 1 auto;
  }

  .landscape-stage canvas {
    image-rendering: pixelated;
    image-rendering: crisp-edges;
  }

  .landscape-stage svg {
    position: relative;
    width: 100%;
    height: auto;
    display: block;
  }

  .widget-panel--loss svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .widget-controls--strip {
    width: 100%;
  }

  .control-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-3) var(--space-5);
    align-items: center;
  }

  @media (max-width: 720px) {
    .control-grid {
      grid-template-columns: 1fr;
    }
  }

  .slider {
    display: grid;
    grid-template-columns: 1fr auto;
    grid-template-rows: auto auto;
    gap: 4px var(--space-3);
    align-items: center;
  }

  .slider .control-label {
    grid-column: 1 / span 2;
    font-family: var(--font-sans);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }

  .slider input[type="range"] {
    grid-column: 1;
  }

  .slider-val {
    grid-column: 2;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text);
    text-align: right;
    min-width: 3.2em;
  }

  .actions {
    display: flex;
    gap: var(--space-3);
    align-items: center;
  }

  .readouts {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .readout {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    min-width: 48px;
  }

  .readout-key {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 12px;
    color: var(--text-muted);
  }

  .readout-val {
    font-family: var(--font-mono);
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
</style>
