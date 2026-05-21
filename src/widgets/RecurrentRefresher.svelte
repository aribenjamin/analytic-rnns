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

  function points(): ZPlanePoint[] {
    return [
      { id: 'pole-0', z: pole, kind: 'pole' },
      { id: 'pole-0-conj', z: poleConj, kind: 'pole', draggable: false },
    ];
  }

  function onDrag(id: string, z: Complex): void {
    if (id !== 'pole-0') return;
    // Clamp magnitude to [0.05, 1.15] so we can show divergence too
    // without letting the spiral fly off-frame instantly.
    const mag = Math.max(0.05, Math.min(1.15, Math.hypot(z.re, z.im)));
    const ang = Math.atan2(z.im, z.re);
    pole = { re: mag * Math.cos(ang), im: mag * Math.sin(ang) };
  }

  function trajectory(): { x: number; y: number }[] {
    const out: { x: number; y: number }[] = new Array(T_TRAJ + 1);
    for (let t = 0; t <= T_TRAJ; t++) {
      const rt = Math.pow(r, t);
      out[t] = { x: rt * Math.cos(t * theta), y: rt * Math.sin(t * theta) };
    }
    return out;
  }

  $: if (zPlane) zPlane.update(points());
  $: if (phaseDraw) phaseDraw.update(trajectory(), r >= 1);

  onMount(() => {
    zPlane = new ZPlane(zSvg, { onDrag });
    zPlane.update(points());
    phaseDraw = new PhasePortrait(phaseSvg, { range: VIEW_RANGE });
    phaseDraw.update(trajectory(), r >= 1);
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

      <g class="schematic-fanin">
        <line x1="100" y1="92" x2="248" y2="36"  stroke="var(--text-muted)" stroke-width="1" opacity="0.55" />
        <line x1="100" y1="92" x2="248" y2="66"  stroke="var(--text-muted)" stroke-width="1" opacity="0.55" />
        <line x1="100" y1="92" x2="248" y2="92"  stroke="var(--text-muted)" stroke-width="1.4" marker-end="url(#rr-arrow)" />
        <line x1="100" y1="92" x2="248" y2="118" stroke="var(--text-muted)" stroke-width="1" opacity="0.55" />
        <line x1="100" y1="92" x2="248" y2="148" stroke="var(--text-muted)" stroke-width="1" opacity="0.55" />
      </g>

      <g class="schematic-fanout">
        <line x1="352" y1="36"  x2="500" y2="92" stroke="var(--text-muted)" stroke-width="1" opacity="0.55" />
        <line x1="352" y1="66"  x2="500" y2="92" stroke="var(--text-muted)" stroke-width="1" opacity="0.55" />
        <line x1="352" y1="92"  x2="500" y2="92" stroke="var(--text-muted)" stroke-width="1.4" marker-end="url(#rr-arrow)" />
        <line x1="352" y1="118" x2="500" y2="92" stroke="var(--text-muted)" stroke-width="1" opacity="0.55" />
        <line x1="352" y1="148" x2="500" y2="92" stroke="var(--text-muted)" stroke-width="1" opacity="0.55" />
      </g>

      <path
        class="schematic-recur"
        d="M 300 16 C 250 -20, 200 30, 250 70"
        fill="none"
        stroke="var(--accent-pole)"
        stroke-width="1.6"
        marker-end="url(#rr-arrow-recur)"
      />
      <text x="220" y="14" font-family="var(--font-serif)" font-style="italic" font-size="14" fill="var(--accent-pole)">W</text>

      <circle cx="100" cy="92"  r="11" fill="var(--bg-elevated)" stroke="var(--accent-active)" stroke-width="1.6" />
      <text x="100" y="96" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="13" fill="var(--text)">x</text>
      <text x="100" y="135" text-anchor="middle" font-family="var(--font-sans)" font-size="10" letter-spacing="0.04em" fill="var(--text-muted)">input</text>

      <g class="schematic-hidden">
        <circle cx="300" cy="36"  r="9" fill="var(--bg-elevated)" stroke="var(--text-soft)" stroke-width="1.4" />
        <circle cx="300" cy="66"  r="9" fill="var(--bg-elevated)" stroke="var(--text-soft)" stroke-width="1.4" />
        <circle cx="300" cy="92"  r="9" fill="var(--accent-soft)" stroke="var(--accent)"     stroke-width="1.6" />
        <circle cx="300" cy="118" r="9" fill="var(--bg-elevated)" stroke="var(--text-soft)" stroke-width="1.4" />
        <circle cx="300" cy="148" r="9" fill="var(--bg-elevated)" stroke="var(--text-soft)" stroke-width="1.4" />
        <text x="270" y="96" text-anchor="end" font-family="var(--font-serif)" font-style="italic" font-size="13" fill="var(--text)">h</text>
        <text x="330" y="148" font-family="var(--font-sans)" font-size="10" fill="var(--text-faint)">n neurons</text>
      </g>

      <circle cx="500" cy="92" r="11" fill="var(--bg-elevated)" stroke="var(--accent-active)" stroke-width="1.6" />
      <text x="500" y="96" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="13" fill="var(--text)">y</text>
      <text x="500" y="135" text-anchor="middle" font-family="var(--font-sans)" font-size="10" letter-spacing="0.04em" fill="var(--text-muted)">readout</text>

      <text x="174" y="78" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="13" fill="var(--text-soft)">b</text>
      <text x="426" y="78" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="13" fill="var(--text-soft)">c<tspan baseline-shift="super" font-size="9">⊤</tspan></text>
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
      <svg bind:this={zSvg}></svg>
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
