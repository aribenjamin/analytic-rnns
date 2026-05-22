<!--
  §8 / Figure 7: direction in ℂ — lines and spirals.

  Trains an actual recurrent network (modal gradient flow, src/lib/gradientFlow.ts)
  on a two-mode target:

    - a WATCHED complex-conjugate mode, initialised silent → it sits at a
      cancellation saddle and must escape;
    - a real SPECTATOR mode, pre-activated at its target residue. It supplies
      the numerator degree a complex zero needs to sit on the complex pole, and
      its residual is what gives the escape coefficient λ a nontrivial phase.

  Two panels: the separation in ℂ (the watched zero leaving its pole, with a
  trail and the fitted theoretical escape overlaid), and the transient — the
  mode's output contribution vs training time. Dial arg(p*) from the real axis
  up into ℂ and the separation turns from a line into a spiral.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { ZPlane, type ZPlanePoint, type ZPlaneTrail } from '../lib/plots/ZPlane';
  import { TimeSeries } from '../lib/plots/TimeSeries';
  import {
    type Mode,
    type ModalState,
    type ModalTarget,
    type TraceSnapshot,
    impulseResponseOfModes,
    simulateTrajectory,
    toModalSystem,
  } from '../lib/gradientFlow';
  import { zeros as zerosOfSystem } from '../lib/transferFn';
  import { type Complex, mul, sub, abs, conj } from '../lib/complex';
  import {
    fitSeparation,
    predictedSeparation,
    transientFrequency,
    transientGrowth,
    type SeparationFit,
  } from '../lib/separationTheory';

  // ── fixed setup ────────────────────────────────────────────────────────
  const P_RADIUS = 0.85; // watched complex pole radius |p*|
  const WATCHED_R = 0.5; // target residue of the watched mode
  const SPECTATOR_P = 0.4; // real spectator pole
  const SPECTATOR_R = 0.7; // spectator residue (pre-activated)
  const T_HORIZON = 110; // impulse-response length
  const ZOOM = 0.5; // z-plane half-range — zoomed onto the watched pole

  const cfg = { dt: 3e-3, steps: 14000, snapshots: 200 };
  // Small, asymmetric, deterministic init: the watched mode starts silent and
  // off the unstable axis, so the escape genuinely curves.
  const INIT_ALPHA: Complex = { re: 9e-4, im: 5e-4 };
  const INIT_BETA: Complex = { re: 6e-4, im: -7e-4 };

  const COL_ACTUAL = '#3b6ea5';
  const COL_PRED = '#d1495b';
  const COL_SPECTATOR = '#9aa0a6';

  // ── knob ───────────────────────────────────────────────────────────────
  let argPDeg = 65; // arg(p*) in degrees, clamped off the real axis

  // ── state ──────────────────────────────────────────────────────────────
  interface Sample {
    tau: number; // gradient-flow time (step × dt)
    eps: Complex; // separation p* − q
    q: Complex; // watched numerator zero
    r: Complex; // watched residue α·β
    transient: number; // mode output contribution 2·Re(r·p*^t₀)
    loss: number;
  }
  let samples: Sample[] = [];
  let qPred: Complex[] = []; // predicted zero trail (forward, clamped)
  let fit: SeparationFit = { lambdaMag: 0, phi: 0, eps0: { re: 0, im: 0 }, tau0: 0 };
  let pStar: Complex = { re: 0, im: 0 };

  let cursor = 0;
  let playing = false;
  let playTimer: number | null = null;
  let retrainTimer: number | null = null;

  let zSvg: SVGSVGElement;
  let tSvg: SVGSVGElement;
  let zPlane: ZPlane | null = null;
  let transientPlot: TimeSeries | null = null;

  function pow(z: Complex, n: number): Complex {
    let acc: Complex = { re: 1, im: 0 };
    for (let i = 0; i < n; i++) acc = mul(acc, z);
    return acc;
  }

  function buildRun(): { target: ModalTarget; init: ModalState } {
    // At arg(p*) = 0 the watched mode is a genuine real pole — its separation
    // is a straight line. For any nonzero angle it is a complex-conjugate pair,
    // whose residue spirals as it escapes.
    const real = argPDeg === 0;
    const sa = Math.sqrt(WATCHED_R);
    const watchedTarget: Mode = real
      ? { kind: 'real', p: pStar.re, alpha: sa, beta: sa }
      : { kind: 'pair', p: { ...pStar }, alpha: { re: sa, im: 0 }, beta: { re: sa, im: 0 } };
    const watchedInit: Mode = real
      ? { kind: 'real', p: pStar.re, alpha: INIT_ALPHA.re, beta: INIT_BETA.re }
      : { kind: 'pair', p: { ...pStar }, alpha: { ...INIT_ALPHA }, beta: { ...INIT_BETA } };

    const spectator = (): Mode => ({
      kind: 'real',
      p: SPECTATOR_P,
      alpha: Math.sqrt(SPECTATOR_R),
      beta: Math.sqrt(SPECTATOR_R),
    });
    const modes = [watchedTarget, spectator()];
    const gStar = impulseResponseOfModes(modes, T_HORIZON);

    // Watched mode silent; spectator pre-activated at its target residue.
    return {
      target: { modes, gStar, T: T_HORIZON },
      init: { modes: [watchedInit, spectator()] },
    };
  }

  function watchedZero(state: ModalState): Complex {
    const zs = zerosOfSystem(toModalSystem(state));
    // The watched pair's numerator zeros are a conjugate pair; take the upper.
    let best: Complex | null = null;
    for (const z of zs) {
      if (z.im > 1e-7 && (best === null || z.im > best.im)) best = z;
    }
    if (best) return best;
    // Fallback (zeros collided on the real axis): nearest to p*.
    let nearest: Complex = { ...pStar };
    let dmin = Infinity;
    for (const z of zs) {
      const d = abs(sub(z, pStar));
      if (d < dmin) {
        dmin = d;
        nearest = z;
      }
    }
    return nearest;
  }

  function retrain(): void {
    const argP = (argPDeg * Math.PI) / 180;
    pStar = { re: P_RADIUS * Math.cos(argP), im: P_RADIUS * Math.sin(argP) };
    const { target, init } = buildRun();
    const trace: TraceSnapshot[] = simulateTrajectory(init, target, cfg);

    // Observe the mode a quarter-period out (t₀·arg p* ≈ 90°) so the transient
    // panel tracks the residue's out-of-phase component — where the spiral's
    // transient lives — rather than its monotonically-growing magnitude.
    const t0 = Math.min(30, Math.max(1, Math.round(Math.PI / 2 / argP)));
    const pPowT0 = pow(pStar, t0);
    samples = trace.map((snap) => {
      const q = watchedZero(snap.state);
      const eps = sub(pStar, q);
      const wm = snap.state.modes[0];
      const r = wm.kind === 'pair' ? mul(wm.alpha, wm.beta) : { re: wm.alpha * wm.beta, im: 0 };
      return {
        tau: snap.tau * cfg.dt,
        eps,
        q,
        r,
        transient: 2 * mul(r, pPowT0).re,
        loss: snap.loss,
      };
    });

    fit = fitSeparation(samples.map((s) => ({ tau: s.tau, eps: s.eps })));

    // Predicted zero trail q = p* − ε_pred over the escape window, forward
    // only, clamped where the linear prediction leaves the action.
    const maxEps = Math.max(1e-6, ...samples.map((s) => abs(s.eps)));
    const fwdTau = samples.filter((s) => s.tau >= fit.tau0).map((s) => s.tau - fit.tau0);
    const epsPred = predictedSeparation(fit.eps0, fit.lambdaMag, fit.phi, fwdTau);
    qPred = [];
    for (const e of epsPred) {
      if (abs(e) > maxEps * 1.3) break;
      qPred.push(sub(pStar, e));
    }

    cursor = samples.length - 1;
    zPlane?.setView(pStar);
    redraw();
  }

  function scheduleRetrain(): void {
    if (retrainTimer !== null) clearTimeout(retrainTimer);
    retrainTimer = window.setTimeout(() => {
      retrainTimer = null;
      pause();
      retrain();
    }, 140);
  }

  function redraw(): void {
    if (!zPlane || !transientPlot || !samples.length) return;
    const i = Math.min(cursor, samples.length - 1);
    const cur = samples[i];
    const last = samples[samples.length - 1];

    zPlane.update([
      { id: 'pole-w', z: pStar, kind: 'pole', draggable: false },
      { id: 'pole-w-conj', z: conj(pStar), kind: 'pole', draggable: false },
      {
        id: 'pole-spec',
        z: { re: SPECTATOR_P, im: 0 },
        kind: 'pole',
        color: COL_SPECTATOR,
        draggable: false,
      },
      { id: 'ghost-zero-final', z: last.q, kind: 'ghost-zero', draggable: false },
      { id: 'ghost-zero-final-conj', z: conj(last.q), kind: 'ghost-zero', draggable: false },
      { id: 'zero-w', z: cur.q, kind: 'zero', draggable: false },
      { id: 'zero-w-conj', z: conj(cur.q), kind: 'zero', draggable: false },
    ]);

    const actual = samples.slice(0, i + 1).map((s) => s.q);
    const trails: ZPlaneTrail[] = [
      { id: 'trail-actual', points: actual, color: COL_ACTUAL },
      { id: 'trail-actual-conj', points: actual.map(conj), color: COL_ACTUAL },
    ];
    if (qPred.length > 1) {
      trails.push({ id: 'trail-pred', points: qPred, color: COL_PRED, dash: '5 4' });
      trails.push({ id: 'trail-pred-conj', points: qPred.map(conj), color: COL_PRED, dash: '5 4' });
    }
    zPlane.setTrails(trails);

    transientPlot.update([
      {
        id: 'transient-all',
        values: samples.map((s) => s.transient),
        color: '#c9ccd1',
        style: 'line',
        width: 1,
        dasharray: '2 3',
      },
      {
        id: 'transient-seen',
        values: samples.slice(0, i + 1).map((s) => s.transient),
        color: COL_ACTUAL,
        style: 'line',
        width: 2.2,
      },
    ]);
  }

  function play(): void {
    if (!samples.length) return;
    playing = true;
    if (cursor >= samples.length - 1) cursor = 0;
    const tick = (): void => {
      cursor++;
      if (cursor >= samples.length - 1) {
        cursor = samples.length - 1;
        playing = false;
        playTimer = null;
        redraw();
        return;
      }
      redraw();
      playTimer = window.setTimeout(tick, 38);
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
    pause();
    cursor = Math.max(
      0,
      Math.min(samples.length - 1, Math.round(+(ev.target as HTMLInputElement).value)),
    );
    redraw();
  }

  onMount(() => {
    zPlane = new ZPlane(zSvg, { range: ZOOM });
    transientPlot = new TimeSeries(tSvg, {
      width: 560,
      height: 430,
      xLabel: 'training time τ (snapshot)',
      yLabel: 'mode output contribution',
    });
    retrain();
  });

  onDestroy(() => {
    pause();
    if (retrainTimer !== null) clearTimeout(retrainTimer);
  });

  // Readouts.
  $: phiDeg = (fit.phi * 180) / Math.PI;
  $: omega = Math.abs(transientFrequency(fit.lambdaMag, fit.phi));
  $: sigma = transientGrowth(fit.lambdaMag, fit.phi);
  $: curLoss = samples.length ? samples[Math.min(cursor, samples.length - 1)].loss : 0;
  $: curRMag = samples.length ? abs(samples[Math.min(cursor, samples.length - 1)].r) : 0;
</script>

<div class="widget widget--spiral-separation">
  <div class="widget-row widget-row--two">
    <div class="widget-panel widget-panel--zplane">
      <div class="widget-panel-header">separation in ℂ — pole × leaving zero ○</div>
      <svg bind:this={zSvg}></svg>
    </div>
    <div class="widget-panel widget-panel--transient">
      <div class="widget-panel-header">the transient — mode output vs training time</div>
      <svg bind:this={tSvg}></svg>
    </div>
  </div>

  <div class="widget-controls">
    <div class="controls-top">
      <label class="slider">
        <span class="control-label">arg(p*) — target pole angle</span>
        <input
          type="range"
          min="0"
          max="160"
          step="1"
          bind:value={argPDeg}
          on:input={scheduleRetrain}
        />
        <span class="slider-val">{argPDeg}°</span>
      </label>
      <div class="widget-btn-row">
        <button class="widget-btn" on:click={playing ? pause : play}>
          {playing ? 'pause' : 'play'}
        </button>
        <button class="widget-btn" on:click={restart}>restart</button>
      </div>
    </div>

    <input
      class="scrub"
      type="range"
      min="0"
      max={Math.max(1, samples.length - 1)}
      value={cursor}
      on:input={onScrub}
    />

    <div class="readouts">
      <div class="readout">
        <span class="readout-key">arg λ</span>
        <span class="readout-val">{phiDeg.toFixed(0)}°</span>
      </div>
      <div class="readout">
        <span class="readout-key">|λ|</span>
        <span class="readout-val">{fit.lambdaMag.toFixed(2)}</span>
      </div>
      <div class="readout">
        <span class="readout-key">ω</span>
        <span class="readout-val">{omega.toFixed(2)}</span>
      </div>
      <div class="readout">
        <span class="readout-key">σ</span>
        <span class="readout-val">{sigma.toFixed(2)}</span>
      </div>
      <div class="readout">
        <span class="readout-key">|r|</span>
        <span class="readout-val">{curRMag.toFixed(3)}</span>
      </div>
      <div class="readout">
        <span class="readout-key">L</span>
        <span class="readout-val">{curLoss.toExponential(1)}</span>
      </div>
    </div>

    <p class="widget-hint">
      The watched mode starts silent — a pole and a zero sitting on top of each
      other, a cancellation saddle. Gradient descent pulls them apart. For a
      near-real target pole the zero leaves along a straight line; swing the
      pole up into the complex plane and the escape becomes a spiral. The dashed
      red curve is the separation-flow prediction, with <code>|λ|</code> and
      <code>arg λ</code> fitted from the run's own early trajectory — the actual
      training lands on it.
    </p>
  </div>
</div>

<style>
  .widget--spiral-separation svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .widget-panel--transient {
    min-width: 0;
  }
  .controls-top {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-5);
    align-items: end;
  }
  .slider {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 6px;
    cursor: default;
  }
  .control-label {
    font-family: var(--font-sans);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .slider-val {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-soft);
    font-variant-numeric: tabular-nums;
  }
  .scrub {
    width: 100%;
  }
  .readouts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-4);
  }
  .readout {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 2px;
    min-width: 52px;
  }
  .readout-key {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 13px;
    color: var(--text-muted);
  }
  .readout-val {
    font-family: var(--font-mono);
    font-size: 15px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }
  @media (max-width: 720px) {
    .controls-top {
      grid-template-columns: 1fr;
      gap: var(--space-3);
    }
    .readouts {
      justify-content: space-between;
    }
  }
</style>
