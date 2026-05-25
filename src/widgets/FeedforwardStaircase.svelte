<!--
  §1 / opening figure: the Saxe saddle-to-saddle staircase, told as image
  reconstruction. A linear autoencoder is trained to reproduce a grayscale
  image. Its modes are the cosine basis (the principal components of natural
  images — the basis JPEG uses), so it discovers the image one frequency band
  at a time, low spatial frequency first. Three panels: the image, the
  network, and the reconstruction; below them the error curve falls in steps.
  Each plateau is a saddle; each cliff is one band of modes switching on.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { sigmaAt } from '../lib/saxe';
  import { dct2, idct2 } from '../lib/dct';
  import { TimeSeries } from '../lib/plots/TimeSeries';

  const N = 64;

  // Radial DCT-frequency band edges, in units of sqrt(u^2 + v^2). The n*n
  // cosine modes are grouped into K bands so the loss falls in a small
  // number of legible steps rather than a smooth 1/f decay. Tunable.
  const BAND_EDGES = [0, 2.5, 5.5, 11, 22, Infinity];
  const K = BAND_EDGES.length - 1;

  // Per-band singular value sigma*_b: the variance the natural-image ensemble
  // carries in band b. Decreasing with frequency (the ~1/f law of natural
  // images), so low spatial frequencies escape their saddle first. Chosen
  // empirically for evenly spaced staircase steps; length must equal K.
  const SIGMA_STARS = [2.6, 1.15, 0.62, 0.4, 0.27];

  // One color per band for the σ_b(τ) panel; length must equal K.
  const BAND_COLORS = [
    'var(--accent-active, #d05a3a)',
    'var(--accent, #1f6feb)',
    'var(--accent-pole, #6a4cb8)',
    'var(--accent-target, #2a9d8f)',
    '#c98a1f',
  ];

  const TAU_MAX = 14;
  const STEPS = 420;
  const PLAY_SECONDS = 7;

  let sigma0 = 1e-4;
  let cursor = STEPS - 1;
  let playing = false;
  let rafId = 0;
  let lastT = 0;
  let ready = false;

  let origCanvas: HTMLCanvasElement;
  let reconCanvas: HTMLCanvasElement;
  let lossSvg: SVGSVGElement;
  let sigmaSvg: SVGSVGElement;
  let root: HTMLDivElement;

  let bandImages: number[][] = [];
  let bandEnergy: number[] = [];
  let totalEnergy = 1;
  let lossTraj: number[] = [];
  let lossPlot: TimeSeries | null = null;
  let sigmaPlot: TimeSeries | null = null;

  $: tau = (TAU_MAX * cursor) / (STEPS - 1);
  $: gains = SIGMA_STARS.map((s) => Math.min(1, sigmaAt(s, sigma0, tau) / s));
  $: modesLearned = gains.filter((g) => g > 0.5).length;
  // Per-band singular value σ_b(τ) over the whole run — each climbs its own
  // sigmoid, and the staircase in the error curve is these stacked in time.
  $: sigmaTraj = SIGMA_STARS.map((s) =>
    Array.from({ length: STEPS }, (_, t) =>
      sigmaAt(s, sigma0, (TAU_MAX * t) / (STEPS - 1)),
    ),
  );
  $: if (ready) lossTraj = computeLoss(sigma0);
  $: if (ready) renderReconstruction(gains);
  $: if (ready) drawLoss(cursor, lossTraj);
  $: if (ready) drawSigma(cursor, sigmaTraj);

  // ─── schematic geometry ────────────────────────────────────────────────
  const CELL_X = 146;
  const CELL_W = 26;
  const CELL_H = 14;
  const CELL_GAP = 4;
  const YC = 122;
  const CELL_Y0 = YC - (K * CELL_H + (K - 1) * CELL_GAP) / 2;
  const cellY = (b: number): number => CELL_Y0 + b * (CELL_H + CELL_GAP);
  const cellMid = (b: number): number => cellY(b) + CELL_H / 2;

  // ─── image ─────────────────────────────────────────────────────────────
  function buildImage(n: number): number[] {
    const c = document.createElement('canvas');
    c.width = n;
    c.height = n;
    const ctx = c.getContext('2d');
    if (!ctx) return new Array<number>(n * n).fill(0);

    const sky = ctx.createLinearGradient(0, 0, 0, n);
    sky.addColorStop(0, '#7d7d7d');
    sky.addColorStop(0.62, '#c8c8c8');
    sky.addColorStop(1, '#e0e0e0');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, n, n);

    const sx = n * 0.71;
    const sy = n * 0.27;
    const glow = ctx.createRadialGradient(sx, sy, 0, sx, sy, n * 0.34);
    glow.addColorStop(0, 'rgba(255,255,255,0.9)');
    glow.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, n, n);
    ctx.beginPath();
    ctx.arc(sx, sy, n * 0.1, 0, 2 * Math.PI);
    ctx.fillStyle = '#fdfdfd';
    ctx.fill();

    const ridge = (pts: [number, number][], fill: string): void => {
      ctx.beginPath();
      ctx.moveTo(0, n);
      for (const [x, y] of pts) ctx.lineTo(x * n, y * n);
      ctx.lineTo(n, n);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    ridge([[0, 0.62], [0.32, 0.44], [0.6, 0.58], [0.85, 0.46], [1, 0.56]], '#9b9b9b');
    ridge([[0, 0.74], [0.22, 0.58], [0.45, 0.7], [0.72, 0.52], [1, 0.66]], '#6e6e6e');
    ridge(
      [[0, 0.82], [0.15, 0.72], [0.3, 0.8], [0.5, 0.62], [0.68, 0.78], [0.86, 0.7], [1, 0.8]],
      '#393939',
    );

    ctx.fillStyle = '#232323';
    ctx.fillRect(0, n * 0.88, n, n * 0.12);

    const tree = (cx: number, baseY: number, h: number): void => {
      ctx.beginPath();
      ctx.moveTo(cx * n, baseY * n - h * n);
      ctx.lineTo(cx * n - h * n * 0.42, baseY * n);
      ctx.lineTo(cx * n + h * n * 0.42, baseY * n);
      ctx.closePath();
      ctx.fillStyle = '#131313';
      ctx.fill();
    };
    tree(0.18, 0.9, 0.13);
    tree(0.31, 0.91, 0.1);
    tree(0.81, 0.92, 0.11);

    const px = ctx.getImageData(0, 0, n, n).data;
    const out = new Array<number>(n * n);
    for (let i = 0; i < n * n; i++) out[i] = px[i * 4] / 255;
    return out;
  }

  function renderImage(canvas: HTMLCanvasElement, data: number[]): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const img = ctx.createImageData(N, N);
    for (let i = 0; i < N * N; i++) {
      const g = Math.round(Math.max(0, Math.min(1, data[i])) * 255);
      img.data[i * 4] = g;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = g;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  function renderReconstruction(g: number[]): void {
    if (!reconCanvas) return;
    const recon = new Array<number>(N * N).fill(0);
    for (let b = 0; b < K; b++) {
      const img = bandImages[b];
      const gb = g[b];
      for (let i = 0; i < N * N; i++) recon[i] += gb * img[i];
    }
    renderImage(reconCanvas, recon);
  }

  function bandOf(u: number, v: number): number {
    const r = Math.hypot(u, v);
    for (let b = 0; b < K; b++) {
      if (r >= BAND_EDGES[b] && r < BAND_EDGES[b + 1]) return b;
    }
    return K - 1;
  }

  function computeLoss(s0: number): number[] {
    const loss = new Array<number>(STEPS);
    for (let t = 0; t < STEPS; t++) {
      const ti = (TAU_MAX * t) / (STEPS - 1);
      let L = 0;
      for (let b = 0; b < K; b++) {
        const gb = sigmaAt(SIGMA_STARS[b], s0, ti) / SIGMA_STARS[b];
        L += bandEnergy[b] * (1 - gb) * (1 - gb);
      }
      loss[t] = L / totalEnergy;
    }
    return loss;
  }

  function drawLoss(upTo: number, traj: number[]): void {
    if (!lossPlot || traj.length === 0) return;
    lossPlot.update([
      {
        id: 'loss-full',
        values: traj,
        color: 'var(--text-faint, #c9c4b8)',
        width: 1,
        dasharray: '3,3',
      },
      {
        id: 'loss',
        values: traj.slice(0, upTo + 1),
        color: 'var(--accent-active, #d05a3a)',
        width: 2.5,
      },
    ]);
  }

  function drawSigma(upTo: number, traj: number[][]): void {
    if (!sigmaPlot || traj.length === 0) return;
    // Dashed targets at σ*_b so each sigmoid's ceiling is visible.
    const targets = SIGMA_STARS.map((s, b) => ({
      id: `target-${b}`,
      values: new Array<number>(STEPS).fill(s),
      color: BAND_COLORS[b % BAND_COLORS.length],
      width: 1,
      dasharray: '2,4',
    }));
    const curves = traj.map((vals, b) => ({
      id: `sigma-${b}`,
      values: vals.slice(0, upTo + 1),
      color: BAND_COLORS[b % BAND_COLORS.length],
      width: 2.25,
    }));
    sigmaPlot.update([...targets, ...curves]);
  }

  // ─── playback ──────────────────────────────────────────────────────────
  function tick(t: number): void {
    if (!playing) return;
    if (lastT === 0) lastT = t;
    const dt = (t - lastT) / 1000;
    lastT = t;
    cursor = Math.min(STEPS - 1, cursor + Math.ceil(dt * (STEPS / PLAY_SECONDS)));
    if (cursor >= STEPS - 1) {
      playing = false;
      lastT = 0;
      return;
    }
    rafId = requestAnimationFrame(tick);
  }
  function play(): void {
    if (cursor >= STEPS - 1) cursor = 0;
    playing = true;
    lastT = 0;
    rafId = requestAnimationFrame(tick);
  }
  function pause(): void {
    playing = false;
    cancelAnimationFrame(rafId);
    lastT = 0;
  }
  function reset(): void {
    pause();
    cursor = 0;
  }

  onMount(() => {
    const original = buildImage(N);
    renderImage(origCanvas, original);

    const coeffs = dct2(original, N);
    const bandCoeffs: number[][] = Array.from({ length: K }, () =>
      new Array<number>(N * N).fill(0),
    );
    for (let u = 0; u < N; u++) {
      for (let v = 0; v < N; v++) {
        bandCoeffs[bandOf(u, v)][u * N + v] = coeffs[u * N + v];
      }
    }
    bandImages = bandCoeffs.map((bc) => idct2(bc, N));
    bandEnergy = bandCoeffs.map((bc) => bc.reduce((s, c) => s + c * c, 0));
    totalEnergy = Math.max(
      bandEnergy.reduce((s, e) => s + e, 0),
      1e-12,
    );

    lossPlot = new TimeSeries(lossSvg, {
      xLabel: 'training time τ →',
      yLabel: 'reconstruction error',
      yLog: true,
    });
    sigmaPlot = new TimeSeries(sigmaSvg, {
      xLabel: 'training time τ →',
      yLabel: 'σ_b(τ)',
      yMin: 0,
      yMax: Math.max(...SIGMA_STARS) * 1.15,
    });
    ready = true;

    const render = (window as any).renderMathInElement;
    if (render && root) {
      render(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
        ],
        throwOnError: false,
      });
    }

    return () => cancelAnimationFrame(rafId);
  });
</script>

<div class="widget widget--ff-staircase" bind:this={root}>
  <div class="widget-banner">Background: Learning dynamics in deep linear nets</div>

  <div class="imgrow">
    <div class="widget-panel">
      <div class="widget-panel-header">the image</div>
      <canvas class="imgcanvas" bind:this={origCanvas} width={N} height={N}></canvas>
    </div>

    <div class="widget-panel netpanel">
      <div class="widget-panel-header">reconstruction network</div>
      <svg class="net" viewBox="0 0 314 240" role="img" aria-label="autoencoder schematic">
        <text class="net-caption" x="157" y="24" text-anchor="middle">ŷ = W₂ W₁ x</text>

        <line class="net-wire" x1="54" y1={YC} x2="60" y2={YC} />
        <line class="net-wire" x1="258" y1={YC} x2="260" y2={YC} />

        <rect class="net-box" x="8" y="95" width="46" height="54" rx="3" />
        <text class="net-sym" x="31" y={YC} text-anchor="middle" dominant-baseline="central"
          >x</text
        >

        <polygon class="net-block" points="60,95 60,149 126,129 126,115" />
        <polygon class="net-block" points="192,115 192,129 258,95 258,149" />

        {#each gains as g, b}
          <line class="net-wire" x1="126" y1={YC} x2={CELL_X} y2={cellMid(b)} />
          <line class="net-wire" x1={CELL_X + CELL_W} y1={cellMid(b)} x2="192" y2={YC} />
        {/each}

        {#each gains as g, b}
          <rect
            class="bn-cell"
            x={CELL_X}
            y={cellY(b)}
            width={CELL_W}
            height={CELL_H}
            rx="2"
            fill-opacity={g}
          />
          <text class="net-cell-num" x={CELL_X - 7} y={cellMid(b)} text-anchor="end"
            dominant-baseline="central">{b + 1}</text
          >
        {/each}

        <rect class="net-box" x="260" y="95" width="46" height="54" rx="3" />
        <text class="net-sym" x="283" y={YC} text-anchor="middle" dominant-baseline="central"
          >ŷ</text
        >

        <text class="net-label" x="93" y="170" text-anchor="middle">encoder · W₁</text>
        <text class="net-label" x="225" y="170" text-anchor="middle">decoder · W₂</text>
        <text class="net-readout" x="159" y="183" text-anchor="middle"
          >{modesLearned} / {K} modes learned</text
        >
      </svg>
    </div>

    <div class="widget-panel">
      <div class="widget-panel-header">reconstruction ŷ</div>
      <canvas class="imgcanvas" bind:this={reconCanvas} width={N} height={N}></canvas>
    </div>
  </div>

  <div class="widget-row widget-row--two">
    <div class="widget-panel">
      <div class="widget-panel-header">
        singular values σ<sub>b</sub>(τ) &mdash; learned in sigmoid stages
      </div>
      <svg bind:this={sigmaSvg}></svg>
    </div>
    <div class="widget-panel">
      <div class="widget-panel-header">reconstruction error vs. training time</div>
      <svg bind:this={lossSvg}></svg>
    </div>
  </div>

  <div class="widget-controls widget-controls--row">
    <div class="widget-btn-row">
      {#if playing}
        <button class="widget-btn" on:click={pause}>pause</button>
      {:else}
        <button class="widget-btn" on:click={play}>
          {cursor >= STEPS - 1 ? 'replay' : 'play'}
        </button>
      {/if}
      <button class="widget-btn" on:click={reset}>reset</button>
    </div>
    <label>
      training time τ = {tau.toFixed(1)}
      <input
        type="range"
        min={0}
        max={STEPS - 1}
        step={1}
        bind:value={cursor}
        on:input={() => {
          if (playing) pause();
        }}
      />
    </label>
    <label>
      init scale σ⁰ = {sigma0.toExponential(1)}
      <input
        type="range"
        min={-5}
        max={-1}
        step={0.25}
        value={Math.log10(sigma0)}
        on:input={(e) => {
          sigma0 = Math.pow(10, parseFloat(e.currentTarget.value));
        }}
      />
    </label>
  </div>

  <p class="widget-hint">
    A two-layer linear network — a linear autoencoder — is trained to reconstruct
    images. The first thing it learns are the first principle components of
    the dataset, in order. The reconstructions look like lowpass filters because 
    natural images have a 1/f power spectrum, so most of
    the variance is highest in low spatial frequencies. In fact, the PCs in fact look like the
    discrete cosine basis — the basis of the JPEG compression scheme (discrete cosine basis).
    I find it to be an incredible 'accident' that linear networks naturally
    learn an efficient compression of natural images through learning dynamics. 
    This network is not structurally
    bottlenecked to learn a low-dimensional representation; at infinite training times it will
    just converge to the identity matrix, $W_2 W_1 = I$.
  </p>
</div>

<style>
  .widget--ff-staircase svg {
    width: 100%;
    height: auto;
    display: block;
  }
  .widget-banner {
    display: inline-block;
    align-self: flex-start;
    background: var(--accent-active, #d05a3a);
    color: #fff;
    font-weight: 600;
    font-size: 0.8rem;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    padding: 0.25rem 0.6rem;
    border-radius: 3px;
  }

  .imgrow {
    display: grid;
    gap: var(--space-4);
    grid-template-columns: 1fr;
  }
  @media (min-width: 720px) {
    .imgrow {
      grid-template-columns: 0.85fr 1.3fr 0.85fr;
    }
  }

  .imgcanvas {
    width: 100%;
    height: auto;
    display: block;
    aspect-ratio: 1 / 1;
    background: #111;
    border: 1px solid var(--rule);
    border-radius: 4px;
  }

  .netpanel {
    justify-content: center;
  }

  /* schematic */
  .net-box {
    fill: var(--bg-subtle);
    stroke: var(--rule-strong);
    stroke-width: 1.25;
  }
  .net-block {
    fill: var(--accent-soft);
    stroke: var(--accent);
    stroke-width: 1.25;
  }
  .net-wire {
    stroke: var(--rule-strong);
    stroke-width: 1;
  }
  .bn-cell {
    fill: var(--accent);
    stroke: var(--rule-strong);
    stroke-width: 1;
  }
  .net-sym {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 16px;
    fill: var(--text);
  }
  .net-caption {
    font-family: var(--font-serif);
    font-style: italic;
    font-size: 13px;
    fill: var(--text-muted);
  }
  .net-label {
    font-family: var(--font-sans);
    font-size: 12px;
    letter-spacing: 0.03em;
    fill: var(--text-muted);
  }
  .net-readout {
    font-family: var(--font-mono);
    font-size: 12px;
    fill: var(--accent-hover);
  }
  .net-cell-num {
    font-family: var(--font-mono);
    font-size: 11px;
    fill: var(--text-faint);
  }

  .widget-controls--row {
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 1rem;
  }
  .widget-controls--row label {
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-size: 0.85rem;
    min-width: 200px;
  }

  @media (max-width: 720px) {
    .widget-controls--row {
      flex-direction: column;
      align-items: stretch;
    }
  }
</style>
