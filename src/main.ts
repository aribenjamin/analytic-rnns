/*
 * Entry point. Mounts each Svelte widget into its <div id="widget-..."> slot
 * in index.html, marks unmounted slots as "coming soon", and wires up the
 * floating TOC's active-section highlight via IntersectionObserver.
 */

import { mount } from './lib/mount';
import TransferFunctionPlayground from './widgets/TransferFunctionPlayground.svelte';

type SvelteWidget = new (...args: any[]) => any;

const widgetRegistry: Record<string, SvelteWidget> = {
  'widget-transfer-function-playground': TransferFunctionPlayground,
  // Phase A widgets remaining:
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

// Mark unmounted slots with a placeholder label.
document.querySelectorAll<HTMLElement>('.widget-slot').forEach((el) => {
  if (!el.id || !(el.id in widgetRegistry)) {
    el.dataset.empty = 'true';
    el.dataset.emptyLabel = labelFromId(el.id);
  }
});

function labelFromId(id: string): string {
  const stripped = id.replace(/^widget-/, '').replace(/-/g, ' ');
  return `${stripped} — coming in next pass`;
}

// ───────────────────────────────────────────────────────────────────────
// Floating TOC: highlight whichever section the reader is currently in.
// ───────────────────────────────────────────────────────────────────────
function installTocObserver(): void {
  const tocLinks = document.querySelectorAll<HTMLAnchorElement>('.toc-list a[data-toc-target]');
  if (!tocLinks.length) return;
  const sections = new Map<string, HTMLAnchorElement>();
  tocLinks.forEach((link) => {
    const id = link.dataset.tocTarget!;
    sections.set(id, link);
  });

  const setActive = (id: string | null): void => {
    tocLinks.forEach((l) => l.classList.toggle('is-active', l.dataset.tocTarget === id));
  };

  let currentlyVisible = new Set<string>();
  const order = Array.from(sections.keys());

  const observer = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) currentlyVisible.add(e.target.id);
        else currentlyVisible.delete(e.target.id);
      }
      // Pick the topmost visible section.
      for (const id of order) {
        if (currentlyVisible.has(id)) {
          setActive(id);
          return;
        }
      }
      // Nothing visible (above the first section or below the last) — default to nearest by viewport position.
      let nearest: string | null = null;
      let nearestDist = Infinity;
      const mid = window.innerHeight / 2;
      for (const id of order) {
        const el = document.getElementById(id);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        if (r.top > mid) continue; // section hasn't been reached yet
        const dist = mid - r.top;
        if (dist < nearestDist) {
          nearestDist = dist;
          nearest = id;
        }
      }
      setActive(nearest);
    },
    {
      rootMargin: '-30% 0px -55% 0px',
      threshold: 0,
    },
  );

  for (const id of order) {
    const el = document.getElementById(id);
    if (el) observer.observe(el);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installTocObserver);
} else {
  installTocObserver();
}

// Hide the floating TOC while the article header is visible, so it doesn't
// overlap the byline. The TOC fades in once the reader has scrolled past
// the title block. A simple scroll handler is more reliable here than
// IntersectionObserver, which has been observed not to fire consistently
// for elements that are entirely outside the viewport.
function installTocHeaderGate(): void {
  const toc = document.getElementById('toc');
  const header = document.querySelector<HTMLElement>('.article-header');
  if (!toc || !header) return;
  const update = (): void => {
    const headerBottom = header.getBoundingClientRect().bottom;
    // Show the TOC once the header has scrolled out of view (with a small
    // grace margin so it doesn't pop in too early).
    const headerVisible = headerBottom > 80;
    toc.classList.toggle('toc--hidden', headerVisible);
  };
  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', installTocHeaderGate);
} else {
  installTocHeaderGate();
}
