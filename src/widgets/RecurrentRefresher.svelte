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
  Deliberately no b, c, no input — that's §3's job.
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
  <div class="widget-panel widget-panel--schematic">
    <div class="widget-panel-header">the network we mean</div>
    <svg class="schematic-svg" viewBox="0 0 600 170" preserveAspectRatio="xMidYMid meet">
      <defs>
        <marker
          id="rr-arrow"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--text-muted)" />
        </marker>
        <marker
          id="rr-arrow-recur"
          viewBox="0 0 10 10"
          refX="8"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L10,5 L0,10 z" fill="var(--accent-pole)" />
        </marker>
      </defs>

      <line x1="100" y1="92" x2="258" y2="92" stroke="var(--text-muted)" stroke-width="1.6" marker-end="url(#rr-arrow)" />
      <line x1="342" y1="92" x2="500" y2="92" stroke="var(--text-muted)" stroke-width="1.6" marker-end="url(#rr-arrow)" />

      <path
        class="schematic-recur"
        d="M 270 57 C 250 3, 350 3, 330 57"
        fill="none"
        stroke="var(--accent-pole)"
        stroke-width="1.6"
        marker-end="url(#rr-arrow-recur)"
      />
      <text x="300" y="9" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="15" fill="var(--accent-pole)">W</text>

      <circle cx="100" cy="92"  r="13" fill="var(--bg-elevated)" stroke="var(--accent-active)" stroke-width="1.6" />
      <text x="100" y="97" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="14" fill="var(--text)">x</text>
      <text x="100" y="137" text-anchor="middle" font-family="var(--font-sans)" font-size="10" letter-spacing="0.04em" fill="var(--text-muted)">input</text>

      <g class="schematic-hidden">
        <circle cx="300" cy="87" r="42" fill="var(--bg-elevated)" stroke="var(--text-soft)" stroke-width="1.4" />
        <circle cx="284" cy="71" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width="1.1" />
        <circle cx="312" cy="73" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width="1.1" />
        <circle cx="298" cy="87" r="4.5" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.3" />
        <circle cx="318" cy="93" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width="1.1" />
        <circle cx="282" cy="97" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width="1.1" />
        <circle cx="302" cy="107" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width="1.1" />
        <text x="300" y="87" text-anchor="middle" dy="-30" font-family="var(--font-serif)" font-style="italic" font-size="14" fill="var(--text)">h</text>
        <text x="300" y="137" text-anchor="middle" font-family="var(--font-sans)" font-size="10" letter-spacing="0.04em" fill="var(--text-muted)">n neurons</text>
      </g>

      <circle cx="500" cy="92" r="13" fill="var(--bg-elevated)" stroke="var(--accent-active)" stroke-width="1.6" />
      <text x="500" y="97" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="14" fill="var(--text)">y</text>
      <text x="500" y="137" text-anchor="middle" font-family="var(--font-sans)" font-size="10" letter-spacing="0.04em" fill="var(--text-muted)">readout</text>

      <text x="179" y="82" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="14" fill="var(--text-soft)">b</text>
      <text x="421" y="82" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="14" fill="var(--text-soft)">c<tspan baseline-shift="super" font-size="10">⊤</tspan></text>
    </svg>
    <p class="schematic-caption">
      Input <em>x<sub>t</sub></em> drives the recurrent population
      <em>h<sub>t</sub></em> through the input weights <em>b</em>; the
      population feeds itself through <em>W</em>; the readout <em>c</em>
      <span class="ts">⊤</span> reduces the population back to a scalar
      <em>y<sub>t</sub></em>. The natural <em>modes</em> of this network
      are set by the eigenvalues of <em>W</em>; that's what the panels
      below let you play with.
    </p>
  </div>

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
      <div class="widget-panel-header">free-evolution trajectory of h(t)</div>
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

  .widget-panel--schematic {
    width: 100%;
  }

  .widget-panel--schematic .schematic-svg {
    max-width: 540px;
    margin: 0 auto var(--space-2);
  }

  .schematic-caption {
    margin: 0;
    font-family: var(--font-sans);
    font-size: 12.5px;
    line-height: 1.55;
    color: var(--text-soft);
    text-align: center;
    max-width: 540px;
    margin-left: auto;
    margin-right: auto;
  }

  .schematic-caption em {
    font-family: var(--font-serif);
    font-style: italic;
    color: var(--text);
  }

  .schematic-caption .ts {
    vertical-align: super;
    font-size: 9px;
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
