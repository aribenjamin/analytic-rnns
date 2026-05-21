<!--
  §4 / Figure 1: the transfer function playground.

  The reader can drag poles and zeros around the z-plane and watch the
  frequency response curve and impulse response update live. This is the
  conceptual hinge of the whole post: by the end of interacting with it,
  the reader should have an embodied sense of "poles set where it rings,
  zeros sculpt the response, and the unit circle is where the audible
  frequencies live."
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import * as d3 from 'd3';
  import { ZPlane, type ZPlanePoint } from '../lib/plots/ZPlane';
  import { BodePlot } from '../lib/plots/BodePlot';
  import { TimeSeries } from '../lib/plots/TimeSeries';
  import {
    type ModalSystem,
    evalH,
    impulseResponse,
    numeratorPoly,
  } from '../lib/transferFn';
  import { polyRoots, organizeRoots } from '../lib/polyRoots';
  import { type Complex, c, expi, mul, sub, div, ZERO, abs } from '../lib/complex';

  // A pair of poles + (optionally) a pair of zeros, all draggable. Default to
  // a single complex-conjugate pole pair (one resonance) and no zeros.
  type PoleSpec = { id: string; z: Complex };
  type ZeroSpec = { id: string; z: Complex; active: boolean };

  let polePairs: PoleSpec[][] = [
    [
      { id: 'pole-0', z: { re: 0.6 * Math.cos(Math.PI / 4), im: 0.6 * Math.sin(Math.PI / 4) } },
      { id: 'pole-0-conj', z: { re: 0.6 * Math.cos(Math.PI / 4), im: -0.6 * Math.sin(Math.PI / 4) } },
    ],
  ];
  let zeroPair: { real: ZeroSpec; conj: ZeroSpec } = {
    real: { id: 'zero-0', z: { re: 0.2, im: 0.3 }, active: false },
    conj: { id: 'zero-0-conj', z: { re: 0.2, im: -0.3 }, active: false },
  };

  let zSvg: SVGSVGElement;
  let bodeSvg: SVGSVGElement;
  let impulseSvg: SVGSVGElement;
  let zPlane: ZPlane | null = null;
  let bode: BodePlot | null = null;
  let impulse: TimeSeries | null = null;

  /** Compute residues at each pole given the current pole and zero positions.
   *  H(z) = Q(z) / P(z), where P(z) = prod_k (z - p_k) and Q(z) = prod_m (z - q_m).
   *  Residue at p_k is Q(p_k) / prod_{j != k} (p_k - p_j). */
  function computeResidues(poles: Complex[], zeros: Complex[]): Complex[] {
    const r: Complex[] = [];
    for (let k = 0; k < poles.length; k++) {
      // Q(p_k) = prod_m (p_k - q_m)
      let qk: Complex = { re: 1, im: 0 };
      for (const q of zeros) qk = mul(qk, sub(poles[k], q));
      // Denom = prod_{j != k} (p_k - p_j)
      let denom: Complex = { re: 1, im: 0 };
      for (let j = 0; j < poles.length; j++) {
        if (j === k) continue;
        denom = mul(denom, sub(poles[k], poles[j]));
      }
      r.push(div(qk, denom));
    }
    return r;
  }

  function currentPoles(): Complex[] {
    return polePairs.flatMap((pair) => pair.map((p) => p.z));
  }
  function currentZeros(): Complex[] {
    return zeroPair.real.active ? [zeroPair.real.z, zeroPair.conj.z] : [];
  }

  function currentSystem(): ModalSystem {
    const poles = currentPoles();
    const zeros = currentZeros();
    const residues = computeResidues(poles, zeros);
    return { poles, residues };
  }

  function points(): ZPlanePoint[] {
    const pts: ZPlanePoint[] = [];
    for (const pair of polePairs) {
      for (const p of pair) {
        pts.push({ id: p.id, z: p.z, kind: 'pole' });
      }
    }
    if (zeroPair.real.active) {
      pts.push({ id: zeroPair.real.id, z: zeroPair.real.z, kind: 'zero' });
      pts.push({ id: zeroPair.conj.id, z: zeroPair.conj.z, kind: 'zero' });
    }
    return pts;
  }

  function redraw(): void {
    zPlane?.update(points());
    const sys = currentSystem();
    // Frequency response on theta in [0, pi].
    const N = 256;
    const theta: number[] = new Array(N);
    const mag: number[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const t = (Math.PI * i) / (N - 1);
      theta[i] = t;
      const v = evalH(sys, expi(t));
      mag[i] = Math.hypot(v.re, v.im);
    }
    bode?.update({ theta, magnitude: mag });
    impulse?.update([
      {
        id: 'impulse',
        values: impulseResponse(sys, 60),
        color: 'var(--accent-active)',
        style: 'line',
      },
    ]);
  }

  function onDrag(id: string, z: Complex): void {
    // Find which pole or zero this id refers to and update it. For complex
    // pairs we mirror the partner. We keep poles strictly inside the unit disk
    // (clamp |p| <= 0.99) and similarly clamp zeros to a sensible range.
    const isConj = id.endsWith('-conj');
    const baseId = isConj ? id.slice(0, -'-conj'.length) : id;
    const partnerId = isConj ? baseId : `${id}-conj`;
    const stableR = Math.max(0.01, Math.min(0.99, Math.hypot(z.re, z.im)));
    const theta = Math.atan2(z.im, z.re);
    const newZ: Complex = { re: stableR * Math.cos(theta), im: stableR * Math.sin(theta) };
    const conjZ: Complex = { re: newZ.re, im: -newZ.im };

    let matched = false;
    for (const pair of polePairs) {
      for (const p of pair) {
        if (p.id === baseId) { p.z = newZ; matched = true; }
        else if (p.id === partnerId) { p.z = conjZ; matched = true; }
      }
    }
    if (!matched) {
      if (zeroPair.real.id === baseId) {
        zeroPair.real.z = newZ;
        zeroPair.conj.z = conjZ;
      } else if (zeroPair.conj.id === baseId) {
        zeroPair.conj.z = newZ;
        zeroPair.real.z = conjZ;
      }
    }
    polePairs = polePairs;
    zeroPair = zeroPair;
    redraw();
  }

  function toggleZero(): void {
    zeroPair.real.active = !zeroPair.real.active;
    zeroPair.conj.active = zeroPair.real.active;
    zeroPair = zeroPair;
    redraw();
  }

  function addPolePair(): void {
    if (polePairs.length >= 3) return;
    const k = polePairs.length;
    const r = 0.65;
    const theta = Math.PI / 3 + (k * Math.PI) / 4;
    polePairs = [
      ...polePairs,
      [
        { id: `pole-${k}`, z: { re: r * Math.cos(theta), im: r * Math.sin(theta) } },
        { id: `pole-${k}-conj`, z: { re: r * Math.cos(theta), im: -r * Math.sin(theta) } },
      ],
    ];
    redraw();
  }

  function removePolePair(): void {
    if (polePairs.length <= 1) return;
    polePairs = polePairs.slice(0, -1);
    redraw();
  }

  onMount(() => {
    zPlane = new ZPlane(zSvg, { onDrag });
    bode = new BodePlot(bodeSvg, { yLog: true, yMin: 0.05, yMax: 50 });
    impulse = new TimeSeries(impulseSvg, {
      xLabel: 'time step t',
      yLabel: 'h_t (impulse response)',
    });
    redraw();
  });

  onDestroy(() => {
    // d3 selections are GC'd when SVGs are detached; no explicit cleanup needed.
  });
</script>

<div class="widget widget--tf-playground">
  <div class="row">
    <div class="panel panel--zplane">
      <div class="panel-header">z-plane</div>
      <svg bind:this={zSvg} class="zplane-svg"></svg>
    </div>
    <div class="panel panel--bode">
      <div class="panel-header">|H(e<sup>iθ</sup>)|: frequency response</div>
      <svg bind:this={bodeSvg} class="bode-svg"></svg>
    </div>
  </div>
  <div class="row">
    <div class="panel panel--impulse">
      <div class="panel-header">impulse response</div>
      <svg bind:this={impulseSvg} class="impulse-svg"></svg>
    </div>
    <div class="controls">
      <div class="control-group">
        <button on:click={addPolePair} disabled={polePairs.length >= 3}>+ pole pair</button>
        <button on:click={removePolePair} disabled={polePairs.length <= 1}>− pole pair</button>
      </div>
      <label class="control-group">
        <input type="checkbox" checked={zeroPair.real.active} on:change={toggleZero} />
        add a zero pair
      </label>
      <p class="hint">
        Drag a pole — the closer it sits to the unit circle, the sharper the resonance peak.
        Add a zero and drag it onto a pole to silence that mode.
      </p>
    </div>
  </div>
</div>

<style>
  .widget--tf-playground {
    --plot-h: 280px;
    display: grid;
    gap: 1rem;
  }
  .row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }
  .panel {
    background: white;
    border-radius: 4px;
    padding: 0.5rem;
  }
  .panel-header {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: #777;
    letter-spacing: 0.05em;
    margin-bottom: 0.25rem;
  }
  .zplane-svg,
  .bode-svg,
  .impulse-svg {
    width: 100%;
    height: var(--plot-h);
    display: block;
  }
  .zplane-svg {
    height: var(--plot-h);
    aspect-ratio: 1;
    max-width: var(--plot-h);
  }
  .controls {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    padding: 0.75rem;
  }
  .control-group {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .control-group button {
    font-size: 0.85rem;
    padding: 0.3rem 0.7rem;
  }
  .hint {
    color: #555;
    font-size: 0.85rem;
    line-height: 1.4;
    margin: 0.25rem 0 0;
  }
  @media (max-width: 720px) {
    .row {
      grid-template-columns: 1fr;
    }
    .widget--tf-playground {
      --plot-h: 220px;
    }
  }
  /* Pole/zero marker styles override the global ones since we set strokes in JS. */
  :global(.marker-pole .pole-stroke) {
    stroke: var(--accent-pole);
    stroke-width: 2;
  }
  :global(.marker-zero .zero-marker) {
    fill: none;
    stroke: var(--accent-zero);
    stroke-width: 2;
  }
</style>
