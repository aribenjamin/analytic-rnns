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
  import NetworkDiagram from '../lib/NetworkDiagram.svelte';
  import {
    type ModalSystem,
    evalH,
    impulseResponse,
    residuesFromZeros,
  } from '../lib/transferFn';
  import { type Complex, expi } from '../lib/complex';

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
    real: { id: 'zero-0', z: { re: 0.2, im: 0.3 }, active: true },
    conj: { id: 'zero-0-conj', z: { re: 0.2, im: -0.3 }, active: true },
  };

  let zSvg: SVGSVGElement;
  let bodeSvg: SVGSVGElement;
  let impulseSvg: SVGSVGElement;
  let zPlane: ZPlane | null = null;
  let bode: BodePlot | null = null;
  let impulse: TimeSeries | null = null;
  let dragged = false;

  function currentPoles(): Complex[] {
    return polePairs.flatMap((pair) => pair.map((p) => p.z));
  }
  function currentZeros(): Complex[] {
    return zeroPair.real.active ? [zeroPair.real.z, zeroPair.conj.z] : [];
  }

  function currentSystem(): ModalSystem {
    const poles = currentPoles();
    const zeros = currentZeros();
    return { poles, residues: residuesFromZeros(poles, zeros) };
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
    dragged = true;
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
      xLabel: 'time step',
      yLabel: 'g (response)',
    });
    redraw();
  });

  onDestroy(() => {
    // d3 selections are GC'd when SVGs are detached; no explicit cleanup needed.
  });
</script>

<div class="widget widget--tf-playground">
  <div class="widget-banner">How Poles and Zeroes Affect I/O Behavior</div>

  <div class="widget-row widget-row--two">
    <div class="widget-panel widget-panel--zplane">
      <div class="widget-panel-header">z-plane</div>
      <div class="zplane-stage">
        <svg bind:this={zSvg}></svg>
        {#if !dragged}
          <span class="drag-hint">drag me ↗</span>
        {/if}
      </div>
    </div>
    <div class="widget-panel">
      <div class="widget-panel-header">|H(e<sup>iθ</sup>)| — frequency response</div>
      <svg bind:this={bodeSvg}></svg>
    </div>
  </div>
  <div class="widget-panel widget-panel--flow">
    <div class="widget-panel-header">impulse response: input → network → output</div>
    <div class="flow-grid">
      <div class="flow-stage flow-stage--input">
        <div class="flow-stage-label">input&nbsp;&nbsp;<em>x<sub>t</sub></em>&nbsp;=&nbsp;δ<sub>t</sub></div>
        <svg class="flow-impulse-svg" viewBox="0 0 120 100" preserveAspectRatio="xMidYMid meet">
          <line x1="16" y1="74" x2="112" y2="74" stroke="var(--text-muted)" stroke-width="1.2" />
          <path d="M108,70 L115,74 L108,78 Z" fill="var(--text-muted)" />
          <text x="113" y="92" text-anchor="end" font-family="var(--font-serif)" font-style="italic" font-size="11" fill="var(--text-muted)">t</text>
          <line x1="28" y1="74" x2="28" y2="22" stroke="var(--accent-pole)" stroke-width="2.4" />
          <circle cx="28" cy="22" r="3.6" fill="var(--accent-pole)" />
          <text x="28" y="13" text-anchor="middle" font-family="var(--font-mono)" font-size="10" fill="var(--text-soft)">1</text>
          <circle cx="44" cy="74" r="2.2" fill="var(--bg)" stroke="var(--text-muted)" stroke-width="1" />
          <circle cx="58" cy="74" r="2.2" fill="var(--bg)" stroke="var(--text-muted)" stroke-width="1" />
          <circle cx="72" cy="74" r="2.2" fill="var(--bg)" stroke="var(--text-muted)" stroke-width="1" />
          <circle cx="86" cy="74" r="2.2" fill="var(--bg)" stroke="var(--text-muted)" stroke-width="1" />
          <circle cx="100" cy="74" r="2.2" fill="var(--bg)" stroke="var(--text-muted)" stroke-width="1" />
        </svg>
      </div>
      <div class="flow-arrow" aria-hidden="true">→</div>
      <div class="flow-stage flow-stage--net">
        <div class="flow-stage-label">the network</div>
        <div class="flow-diagram"><NetworkDiagram compact /></div>
      </div>
      <div class="flow-arrow" aria-hidden="true">→</div>
      <div class="flow-stage flow-stage--output">
        <div class="flow-stage-label">response&nbsp;&nbsp;<em>g<sub>s</sub></em></div>
        <svg bind:this={impulseSvg}></svg>
      </div>
    </div>
  </div>
  <div class="widget-controls">
    <div class="controls-strip">
      <div class="widget-btn-row">
        <button class="widget-btn" on:click={addPolePair} disabled={polePairs.length >= 3}>+ pole pair</button>
        <button class="widget-btn" on:click={removePolePair} disabled={polePairs.length <= 1}>− pole pair</button>
      </div>
      <label>
        <input type="checkbox" checked={zeroPair.real.active} on:change={toggleZero} />
        add a zero pair
      </label>
    </div>
    <p class="widget-hint">
      Drag a pole — the closer it sits to the unit circle, the sharper the
      resonance. Add a zero and drag it onto a pole to silence the mode.
    </p>
  </div>
</div>

<style>
  .widget--tf-playground svg {
    width: 100%;
    height: auto;
    display: block;
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

  /* Impulse-response panel: input → network → response, read left to right. */
  .flow-grid {
    display: flex;
    align-items: stretch;
    gap: var(--space-2);
  }

  .flow-stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .flow-stage--input {
    flex: 0.58 1 0;
  }
  .flow-stage--net {
    flex: 1.42 1 0;
  }
  .flow-stage--output {
    flex: 1.4 1 0;
  }

  /* Centre the compact input schematic against the taller response plot. */
  .flow-impulse-svg {
    margin: auto;
    max-width: 240px;
  }

  .flow-stage-label {
    font-family: var(--font-sans);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    text-align: center;
  }

  .flow-stage-label em {
    font-family: var(--font-serif);
    font-style: italic;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text);
  }

  /* Auto margins centre the wide-aspect schematic against the taller plots;
     the max-width keeps it sane once the stages stack on mobile. */
  .flow-diagram {
    margin: auto;
    width: 100%;
    max-width: 360px;
  }

  .flow-diagram :global(.network-diagram-svg) {
    width: 100%;
    height: auto;
    display: block;
  }

  .flow-arrow {
    flex: 0 0 auto;
    align-self: center;
    font-size: 22px;
    line-height: 1;
    color: var(--text-muted);
  }

  .controls-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-3) var(--space-4);
  }

  @media (max-width: 720px) {
    .flow-grid {
      flex-direction: column;
    }
    .flow-stage {
      flex: 0 0 auto;
    }
    .flow-arrow {
      transform: rotate(90deg);
    }
  }
</style>
