<!--
  §5 / Figure 2: the residue is a volume knob.

  One fixed complex-conjugate pole pair at p = 0.95 e^{iπ/4}. One conjugate
  zero pair, controlled by a single "separation" slider that moves the zero
  along the line from the origin through the pole. At s = 0 the zero sits on
  the pole and the mode is silent; sliding it away grows the residue
  (approximately linearly for small s) and the frequency-response peak.

  Only one degree of freedom on purpose — §4 already covers free dragging.
  Here the metaphor is the volume knob, and a knob is one-dimensional.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { ZPlane, type ZPlanePoint } from '../lib/plots/ZPlane';
  import { BodePlot } from '../lib/plots/BodePlot';
  import { type ModalSystem, evalH, residuesFromZeros } from '../lib/transferFn';
  import { type Complex, expi, abs } from '../lib/complex';

  const POLE_R = 0.95;
  const POLE_THETA = Math.PI / 4;
  const pole: Complex = {
    re: POLE_R * Math.cos(POLE_THETA),
    im: POLE_R * Math.sin(POLE_THETA),
  };
  const poleConj: Complex = { re: pole.re, im: -pole.im };
  const radialDir: Complex = { re: Math.cos(POLE_THETA), im: Math.sin(POLE_THETA) };

  // Cap s at 0.30 so |r| stays within ~17% of s — past this the curve visibly
  // bends and would contradict the "linear in separation" prose.
  const S_MAX = 0.30;
  let s = 0.10;

  $: zero = { re: pole.re + s * radialDir.re, im: pole.im + s * radialDir.im };
  $: zeroConj = { re: zero.re, im: -zero.im };
  $: residues = residuesFromZeros([pole, poleConj], [zero, zeroConj]);
  $: sys = { poles: [pole, poleConj], residues } as ModalSystem;
  $: rMag = residues.length ? abs(residues[0]) : 0;

  let zSvg: SVGSVGElement;
  let bodeSvg: SVGSVGElement;
  let zPlane: ZPlane | null = null;
  let bode: BodePlot | null = null;

  function points(): ZPlanePoint[] {
    return [
      { id: 'pole-0', z: pole, kind: 'pole', draggable: false },
      { id: 'pole-0-conj', z: poleConj, kind: 'pole', draggable: false },
      { id: 'zero-0', z: zero, kind: 'zero', draggable: false },
      { id: 'zero-0-conj', z: zeroConj, kind: 'zero', draggable: false },
    ];
  }

  function redraw(): void {
    if (!zPlane || !bode) return;
    zPlane.update(points());
    const N = 256;
    const theta: number[] = new Array(N);
    const mag: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const t = (Math.PI * i) / (N - 1);
      theta[i] = t;
      const v = evalH(sys, expi(t));
      mag[i] = Math.hypot(v.re, v.im);
    }
    bode.update({ theta, magnitude: mag });
  }

  // Anything downstream of `s` (zero, residues, sys, rMag) is re-derived above
  // before this block fires, so redraw() always sees the current system.
  $: {
    void s;
    void sys;
    redraw();
  }

  onMount(() => {
    zPlane = new ZPlane(zSvg, {});
    // Peak at s = 0.30 is ~|r| / (1 - |p|) ≈ 0.35 / 0.05 = 7; yMax = 9 leaves
    // headroom and a linear axis so the peak's growth reads as linear.
    bode = new BodePlot(bodeSvg, { yLog: false, yMin: 0, yMax: 9 });
    redraw();
  });
</script>

<div class="widget widget--residue-knob">
  <div class="widget-row widget-row--two">
    <div class="widget-panel widget-panel--zplane">
      <div class="widget-panel-header">z-plane</div>
      <svg bind:this={zSvg}></svg>
    </div>
    <div class="widget-panel">
      <div class="widget-panel-header">|H(e<sup>iθ</sup>)| — frequency response</div>
      <svg bind:this={bodeSvg}></svg>
    </div>
  </div>
  <div class="widget-controls widget-controls--strip">
    <div class="control-row">
      <label class="separation-slider">
        <span class="control-label">pole–zero separation</span>
        <input type="range" min="0" max={S_MAX} step="0.005" bind:value={s} />
      </label>
      <div class="readouts">
        <div class="readout">
          <span class="readout-key">s</span>
          <span class="readout-val">{s.toFixed(3)}</span>
        </div>
        <div class="readout">
          <span class="readout-key">|r|</span>
          <span class="readout-val">{rMag.toFixed(3)}</span>
        </div>
      </div>
    </div>
    <p class="widget-hint">
      Slide the zero away from the pole. At <code>s = 0</code> the zero sits
      on the pole, the residue is exactly zero, and the resonance vanishes.
      As <code>s</code> grows, <code>|r|</code> grows roughly in proportion —
      the residue is a volume knob on the mode at the pole's frequency.
    </p>
  </div>
</div>

<style>
  .widget--residue-knob svg {
    width: 100%;
    height: auto;
    display: block;
  }

  .widget-controls--strip {
    /* Single full-width strip — no second column, since there's only one knob. */
    width: 100%;
  }

  .control-row {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-5);
    align-items: center;
  }

  .separation-slider {
    display: flex;
    flex-direction: column;
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

  .readouts {
    display: flex;
    gap: var(--space-4);
  }

  .readout {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 2px;
    min-width: 56px;
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

  @media (max-width: 720px) {
    .control-row {
      grid-template-columns: 1fr;
      gap: var(--space-3);
    }
    .readouts {
      justify-content: space-between;
    }
  }
</style>
