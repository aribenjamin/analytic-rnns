<!--
  §2 / Figure: the recurrent network we study.

  A static schematic of  h_{t+1} = W h_t + b x_t,  y_t = cᵀh_t — input x
  driving the recurrent population h through b, the population feeding
  itself through W, the readout c collapsing it back to a scalar y.
  Mounted directly after the §2 equation it illustrates. Non-interactive;
  the eigenvalue playground is its own widget (RecurrentRefresher). The bare
  diagram is the shared NetworkDiagram component, also reused in §3.
-->
<script lang="ts">
  import NetworkDiagram from '../lib/NetworkDiagram.svelte';
</script>

<div class="widget-panel widget-panel--schematic">
  <div class="widget-panel-header">the network we mean</div>
  <NetworkDiagram />
  <p class="schematic-caption">
    Scalar input <em>x<sub>t</sub></em> drives the recurrent population
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

  .widget-panel--schematic :global(.network-diagram-svg) {
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
