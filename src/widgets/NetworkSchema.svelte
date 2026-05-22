<!--
  §2 / Figure: the recurrent network we study.

  A static schematic of  h_{t+1} = W h_t + b x_t,  y_t = cᵀh_t — input x
  driving the recurrent population h through b, the population feeding
  itself through W, the readout c collapsing it back to a scalar y.
  Mounted directly after the §2 equation it illustrates. Non-interactive;
  the eigenvalue playground is its own widget (RecurrentRefresher).
-->
<div class="widget-panel widget-panel--schematic">
  <div class="widget-panel-header">the network we mean</div>
  <svg class="schematic-svg" viewBox="0 -10 600 180" preserveAspectRatio="xMidYMid meet">
    <defs>
      <marker
        id="ns-arrow"
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
        id="ns-arrow-recur"
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

    <line x1="100" y1="92" x2="258" y2="92" stroke="var(--text-muted)" stroke-width="1.6" marker-end="url(#ns-arrow)" />
    <line x1="342" y1="92" x2="500" y2="92" stroke="var(--text-muted)" stroke-width="1.6" marker-end="url(#ns-arrow)" />

    <path
      class="schematic-recur"
      d="M 270 50 C 250 -4, 350 -4, 330 50"
      fill="none"
      stroke="var(--accent-pole)"
      stroke-width="1.6"
      marker-end="url(#ns-arrow-recur)"
    />
    <text x="300" y="2" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="15" fill="var(--accent-pole)">W</text>

    <circle cx="100" cy="92"  r="13" fill="var(--bg-elevated)" stroke="var(--accent-active)" stroke-width="1.6" />
    <text x="100" y="97" text-anchor="middle" font-family="var(--font-serif)" font-style="italic" font-size="14" fill="var(--text)">x</text>
    <text x="100" y="137" text-anchor="middle" font-family="var(--font-sans)" font-size="10" letter-spacing="0.04em" fill="var(--text-muted)">input</text>

    <g class="schematic-hidden">
      <circle cx="300" cy="80" r="42" fill="var(--bg-elevated)" stroke="var(--text-soft)" stroke-width="1.4" />
      <circle cx="284" cy="64" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width="1.1" />
      <circle cx="312" cy="66" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width="1.1" />
      <circle cx="298" cy="80" r="4.5" fill="var(--accent-soft)" stroke="var(--accent)" stroke-width="1.3" />
      <circle cx="318" cy="86" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width="1.1" />
      <circle cx="282" cy="90" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width="1.1" />
      <circle cx="302" cy="100" r="4.5" fill="var(--bg)" stroke="var(--text-soft)" stroke-width="1.1" />
      <text x="300" y="80" text-anchor="middle" dy="-25" font-family="var(--font-serif)" font-style="italic" font-size="14" fill="var(--text)">h</text>
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
    are set by the eigenvalues of <em>W</em>.
  </p>
</div>

<style>
  .widget-panel--schematic {
    width: 100%;
  }

  .widget-panel--schematic .schematic-svg {
    width: 100%;
    height: auto;
    display: block;
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
</style>
