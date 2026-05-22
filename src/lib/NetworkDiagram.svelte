<!--
  The recurrent network schematic:  h_{t+1} = W h_t + b x_t,  y_t = cᵀh_t.
  Input x drives the recurrent population h through b, h feeds itself through
  W, the readout cᵀ collapses h back to a scalar y. Pure presentational SVG,
  reused by §2 (NetworkSchema) and §3 (TransferFunctionPlayground). Marker ids
  are per-instance so two copies on one page don't collide.

  `compact` is for the §3 inline flow, where the diagram renders at roughly a
  third of its §2 size: it enlarges the symbol type and stroke weights so the
  thumbnail stays legible, drops the small sublabels that turn to noise at
  that scale, and crops the now-empty bottom margin.
-->
<script context="module" lang="ts">
  let instanceCount = 0;
</script>

<script lang="ts">
  export let compact = false;

  const uid = `nd${instanceCount++}`;
  const arrowId = `${uid}-arrow`;
  const recurId = `${uid}-arrow-recur`;

  $: sym = compact ? 22 : 14;
  $: wsym = compact ? 23 : 15;
  $: tsup = compact ? 13 : 10;
  $: sw = compact ? 1.5 : 1;
  $: viewBox = compact ? '0 -14 600 144' : '0 -10 600 180';
</script>

<svg class="network-diagram-svg" {viewBox} preserveAspectRatio="xMidYMid meet">
  <defs>
    <marker
      id={arrowId}
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
      id={recurId}
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

  <line x1="100" y1="92" x2="258" y2="92" stroke="var(--text-muted)" stroke-width={1.6 * sw} marker-end="url(#{arrowId})" />
  <line x1="342" y1="92" x2="500" y2="92" stroke="var(--text-muted)" stroke-width={1.6 * sw} marker-end="url(#{arrowId})" />

  <path
    class="schematic-recur"
    d="M 270 50 C 250 -4, 350 -4, 330 50"
    fill="none"
    stroke="var(--accent-pole)"
    stroke-width={1.6 * sw}
    marker-end="url(#{recurId})"
  />
  <text x="300" y="2" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size={wsym} fill="var(--accent-pole)">W</text>

  <circle cx="100" cy="92"  r="13" fill="var(--bg-elevated)" stroke="var(--accent-active)" stroke-width={1.6 * sw} />
  <text x="100" y="97" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size={sym} fill="var(--text)">x</text>
  {#if !compact}
    <text x="100" y="137" text-anchor="middle" font-family="var(--font-sans)" font-size="10" letter-spacing="0.04em" fill="var(--text-muted)">input</text>
  {/if}

  <g class="schematic-hidden">
    <circle cx="300" cy="80" r="42" fill="var(--bg-elevated)" stroke="var(--text-soft)" stroke-width={1.4 * sw} />
    <circle cx="284" cy="64" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width={1.1 * sw} />
    <circle cx="312" cy="66" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width={1.1 * sw} />
    <circle cx="298" cy="80" r="4.5" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width={1.3 * sw} />
    <circle cx="318" cy="86" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width={1.1 * sw} />
    <circle cx="282" cy="90" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width={1.1 * sw} />
    <circle cx="302" cy="100" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width={1.1 * sw} />
    <text x="300" y="80" text-anchor="middle" dy="-25" font-family="var(--font-serif)" font-style="italic" font-size={sym} fill="var(--text)">h</text>
    {#if !compact}
      <text x="300" y="137" text-anchor="middle" font-family="var(--font-sans)" font-size="10" letter-spacing="0.04em" fill="var(--text-muted)">n neurons</text>
    {/if}
  </g>

  <circle cx="500" cy="92" r="13" fill="var(--bg-elevated)" stroke="var(--accent-active)" stroke-width={1.6 * sw} />
  <text x="500" y="97" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size={sym} fill="var(--text)">y</text>
  {#if !compact}
    <text x="500" y="137" text-anchor="middle" font-family="var(--font-sans)" font-size="10" letter-spacing="0.04em" fill="var(--text-muted)">readout</text>
  {/if}

  <text x="179" y="82" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size={sym} fill="var(--text-soft)">b</text>
  <text x="421" y="82" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size={sym} fill="var(--text-soft)">c<tspan baseline-shift="super" font-size={tsup}>⊤</tspan></text>
</svg>
