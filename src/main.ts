/*
 * Entry point. Mounts each Svelte widget into its <div id="widget-..."> slot in
 * index.html. Adding a new widget is a three-step dance:
 *
 *   1. Add a <div id="widget-FOO" class="widget-slot"></div> in index.html.
 *   2. Build src/widgets/Foo.svelte.
 *   3. Register it in `widgetRegistry` below.
 */

import { mount } from './lib/mount';
import TransferFunctionPlayground from './widgets/TransferFunctionPlayground.svelte';

type SvelteWidget = new (...args: any[]) => any;

const widgetRegistry: Record<string, SvelteWidget> = {
  'widget-transfer-function-playground': TransferFunctionPlayground,
  // Other widgets register here as they're built:
  // 'widget-feedforward-staircase': FeedforwardStaircase,
  // 'widget-recurrent-refresher': RecurrentRefresher,
  // 'widget-eigenvalues-are-not-enough': EigenvaluesAreNotEnough,
  // 'widget-residue-knob': ResidueKnob,
  // 'widget-saddle-landscape': SaddleLandscape,
  // 'widget-decoded-staircase': DecodedStaircase,
};

for (const [slotId, Component] of Object.entries(widgetRegistry)) {
  mount(slotId, Component);
}

// Mark unmounted slots so the empty-state CSS kicks in.
document.querySelectorAll<HTMLElement>('.widget-slot').forEach((el) => {
  if (!el.id || !(el.id in widgetRegistry)) {
    el.dataset.empty = 'true';
  }
});
