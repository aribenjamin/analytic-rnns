<!--
  §2 / Figure: a refresher on what eigenvalues do.

  The reader drags one complex-conjugate eigenvalue of W (on or inside the
  unit disk) and watches the free-evolution trajectory of the corresponding
  2-D mode in real coordinates. For a complex-conjugate eigenvalue pair
  p = r e^{iθ}, the 2×2 real block of W acts as r · R(θ) — a rotation by
  θ followed by an isotropic scaling by r. Starting from h₀ = (1, 0), the
  trajectory is

      h(t) = r^t · (cos tθ, sin tθ),

  i.e. a spiral that shrinks for |λ|<1, grows for |λ|>1, and rides the
  unit circle for |λ|=1.

  This sets up the "eigenvalues feel like the right object" intuition that
  §3 (transfer functions) then refines by introducing zeros and residues.
  Deliberately no b, c, no input — only the internal state h evolves here,
  never the readout y; a scope note above the panels makes that explicit.
  The network schematic that motivates the setup is its own widget
  (NetworkSchema), mounted directly after the §2 equation.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { ZPlane, type ZPlanePoint } from '../lib/plots/ZPlane';
  import { PhasePortrait } from '../lib/plots/PhasePortrait';
  import { type Complex } from '../lib/complex';

  const T_TRAJ = 50;
  const VIEW_RANGE = 1.6;

  let pole: Complex = {
    re: 0.85 * Math.cos(Math.PI / 6),
    im: 0.85 * Math.sin(Math.PI / 6),
  };
  $: poleConj = { re: pole.re, im: -pole.im } as Complex;
  $: r = Math.hypot(pole.re, pole.im);
  $: theta = Math.atan2(pole.im, pole.re);

  // |λ|^τ = 1/e  ⇒  τ = -1/ln|λ|. For |λ| ≥ 1 the time constant is Infinity.
  $: tauDecay = r > 0 && r < 1 ? -1 / Math.log(r) : Infinity;
  $: period = Math.abs(theta) > 1e-6 ? (2 * Math.PI) / Math.abs(theta) : Infinity;

  let zSvg: SVGSVGElement;
  let phaseSvg: SVGSVGElement;
  let zPlane: ZPlane | null = null;
  let phaseDraw: PhasePortrait | null = null;
  let dragged = false;

  // Derive plot inputs as reactive values, not function calls — Svelte 4's
  // static analyzer doesn't trace into function bodies, so referring to
  // `pole` only inside `points()` wouldn't make the redraw statement
  // depend on `pole`.
  $: zPlanePoints = [
    { id: 'pole-0', z: pole, kind: 'pole' as const },
    { id: 'pole-0-conj', z: poleConj, kind: 'pole' as const, draggable: false },
  ] satisfies ZPlanePoint[];

  $: trajectoryPts = Array.from({ length: T_TRAJ + 1 }, (_, t) => {
    const rt = Math.pow(r, t);
    return { x: rt * Math.cos(t * theta), y: rt * Math.sin(t * theta) };
  });

  function onDrag(id: string, z: Complex): void {
    if (id !== 'pole-0') return;
    dragged = true;
    // Clamp magnitude to [0.05, 1.15] so we can show divergence too
    // without letting the spiral fly off-frame instantly.
    const mag = Math.max(0.05, Math.min(1.15, Math.hypot(z.re, z.im)));
    const ang = Math.atan2(z.im, z.re);
    pole = { re: mag * Math.cos(ang), im: mag * Math.sin(ang) };
  }

  $: zPlane?.update(zPlanePoints);
  $: phaseDraw?.update(trajectoryPts, r >= 1);

  onMount(() => {
    zPlane = new ZPlane(zSvg, { onDrag });
    phaseDraw = new PhasePortrait(phaseSvg, { range: VIEW_RANGE });
  });
</script>

<div class="widget widget--recurrent">
  <div class="widget-banner">Primer: Eigenvalues of W and the internal state h(t)</div>

  <p class="scope-note">
    These panels show the network's <strong>internal state</strong> only —
    the population <em>h</em> evolving under its own recurrence,
    <span class="eqn"><em>h<sub>t+1</sub></em>&nbsp;=&nbsp;<em>W</em>&thinsp;<em>h<sub>t</sub></em></span>.
    They do not show the output
    <span class="eqn eqn--off"><em>y<sub>t</sub></em>&nbsp;=&nbsp;<em>c</em><sup>⊤</sup><em>h<sub>t</sub></em></span>;
    that&nbsp;readout&nbsp;enters&nbsp;in&nbsp;§&nbsp;3.
  </p>

  <div class="widget-row widget-row--two">
    <div class="widget-panel widget-panel--zplane">
      <div class="widget-panel-header">eigenvalues of W in the complex plane</div>
      <div class="zplane-stage">
        <svg bind:this={zSvg}></svg>
        {#if !dragged}
          <span class="drag-hint">drag me ↗</span>
        {/if}
      </div>
    </div>
    <div class="widget-panel widget-panel--phase">
      <div class="widget-panel-header">free evolution of the internal state h(t)</div>
      <svg bind:this={phaseSvg}></svg>
    </div>
  </div>

  <div class="widget-controls widget-controls--strip">
    <div class="readouts">
      <div class="readout">
        <span class="readout-key">|λ|</span>
        <span class="readout-val">{r.toFixed(2)}</span>
        <span class="readout-sub">{r < 1 ? 'decay' : r > 1 ? 'growth' : 'sustained'}</span>
      </div>
      <div class="readout">
        <span class="readout-key">arg λ</span>
        <span class="readout-val">{(theta / Math.PI).toFixed(2)}π</span>
        <span class="readout-sub">rotation per step</span>
      </div>
      <div class="readout">
        <span class="readout-key">τ</span>
        <span class="readout-val">{Number.isFinite(tauDecay) ? tauDecay.toFixed(1) : '—'}</span>
        <span class="readout-sub">decay time (steps)</span>
      </div>
      <div class="readout">
        <span class="readout-key">T</span>
        <span class="readout-val">{Number.isFinite(period) ? period.toFixed(1) : '—'}</span>
        <span class="readout-sub">period (steps)</span>
      </div>
    </div>
    <p class="widget-hint">
      Drag the eigenvalue. Under the free recurrence
      <code>h<sub>t+1</sub> = W h<sub>t</sub></code>, the two-dimensional
      subspace of a complex-conjugate pair λ, λ̄ acts on h as a rotation by
      <code>arg λ</code> per step combined with an isotropic scaling by
      <code>|λ|</code>. Inside the unit circle: a damped spiral. On it: a
      pure orbit. Outside: divergence. The eigenvalues feel like the right
      "modes" of the network — they set where it rings and how long it
      remembers. The next sections show what's still missing.
    </p>
  </div>
</div>

<style>
  .widget--recurrent :global(.widget-row--two) {
    /* minmax(0, 1fr) lets the grid items shrink below their intrinsic
       min-content; otherwise the SVG-driven aspect-ratio: 1/1 panels
       balloon past the slot's right edge. */
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .widget--recurrent svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .widget-panel--phase {
    aspect-ratio: 1 / 1;
    min-width: 0;
  }

  .widget-panel--zplane {
    min-width: 0;
  }

  .zplane-stage {
    position: relative;
    width: 100%;
  }

  .drag-hint {
    position: absolute;
    bottom: 10px;
    left: 12px;
    font-family: var(--font-sans);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    background: var(--bg);
    padding: 3px 8px;
    border-radius: 4px;
    border: 1px solid var(--rule);
    pointer-events: none;
    box-shadow: 0 1px 2px rgba(58, 47, 30, 0.06);
  }

  .scope-note {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 13px;
    line-height: 1.65;
    color: var(--text-soft);
    padding: var(--space-2) var(--space-3);
    background: var(--bg-subtle);
    border-radius: 6px;
    border-left: 2px solid var(--accent-pole);
  }

  .scope-note strong {
    color: var(--text);
    font-weight: 600;
  }

  .scope-note em {
    font-family: var(--font-serif);
    font-style: italic;
    color: var(--text);
  }

  .scope-note .eqn {
    font-family: var(--font-serif);
    font-size: 14.5px;
    white-space: nowrap;
  }

  .scope-note .eqn--off,
  .scope-note .eqn--off em {
    color: var(--text-muted);
  }

  .widget-controls--strip {
    width: 100%;
  }

  .readouts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: var(--space-3);
  }

  .readout {
    display: flex;
    flex-direction: column;
    gap: 1px;
    align-items: flex-start;
  }

  .readout-key {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 13px;
    color: var(--text-muted);
  }

  .readout-val {
    font-family: var(--font-mono);
    font-size: 16px;
    font-variant-numeric: tabular-nums;
    color: var(--text);
  }

  .readout-sub {
    font-family: var(--font-sans);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
  }

  @media (max-width: 720px) {
    .widget--recurrent :global(.widget-row--two) {
      grid-template-columns: 1fr;
    }
    .readouts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
