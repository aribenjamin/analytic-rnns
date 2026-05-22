/*
 * Entry point. Auto-discovers every Svelte widget in src/widgets/ via Vite's
 * `import.meta.glob`, derives its slot id from the filename, and mounts it
 * into the matching <div id="widget-..."> in index.html.
 *
 * Convention: a widget file `Foo.svelte` mounts into `widget-foo` (with
 * PascalCase → kebab-case). So `TransferFunctionPlayground.svelte` →
 * `widget-transfer-function-playground`. To add a new widget, drop a file
 * with the right name and a matching slot in index.html — no edit here.
 */

import { mount } from './lib/mount';

type SvelteWidget = new (...args: any[]) => any;

const widgetModules = import.meta.glob<{ default: SvelteWidget }>(
  './widgets/*.svelte',
  { eager: true },
);

function slotIdFromPath(path: string): string {
  const name = path.split('/').pop()!.replace(/\.svelte$/, '');
  return (
    'widget-' +
    name
      .replace(/([A-Z])/g, '-$1')
      .toLowerCase()
      .replace(/^-/, '')
  );
}

const widgetRegistry: Record<string, SvelteWidget> = {};
for (const [path, mod] of Object.entries(widgetModules)) {
  widgetRegistry[slotIdFromPath(path)] = mod.default;
}

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
// <d-popup> custom element: auto-numbered inline popup notes.
// ───────────────────────────────────────────────────────────────────────
let popupCounter = 0;

class DPopup extends HTMLElement {
  connectedCallback(): void {
    popupCounter += 1;
    const num = popupCounter;

    const content = this.innerHTML;
    this.innerHTML = '';

    const marker = document.createElement('span');
    marker.className = 'fn-marker';
    marker.textContent = String(num);
    marker.setAttribute('role', 'button');
    marker.setAttribute('aria-label', `Note ${num}`);
    marker.tabIndex = 0;

    const popup = document.createElement('span');
    popup.className = 'fn-content';
    popup.innerHTML = content;

    this.appendChild(marker);
    this.appendChild(popup);

    const toggle = (e: Event): void => {
      e.stopPropagation();
      const opening = !this.classList.contains('fn-open');
      document.querySelectorAll('d-popup.fn-open').forEach((el) =>
        el.classList.remove('fn-open', 'fn-flip'),
      );
      if (opening) {
        this.classList.add('fn-open');
        const rect = popup.getBoundingClientRect();
        if (rect.top < 0) {
          this.classList.add('fn-flip');
        }
      }
    };

    marker.addEventListener('click', toggle);
    marker.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggle(e);
      }
    });
  }
}

if (!customElements.get('d-popup')) {
  customElements.define('d-popup', DPopup);
}

document.addEventListener('click', () => {
  document.querySelectorAll('d-popup.fn-open').forEach((el) =>
    el.classList.remove('fn-open', 'fn-flip'),
  );
});

// ───────────────────────────────────────────────────────────────────────
// <d-footnote> custom element: real bottom-of-article footnotes.
// ───────────────────────────────────────────────────────────────────────
let footnoteCounter = 0;
const footnoteEntries: { num: number; html: string }[] = [];

class DFootnote extends HTMLElement {
  connectedCallback(): void {
    footnoteCounter += 1;
    const num = footnoteCounter;

    const content = this.innerHTML;
    this.innerHTML = '';

    footnoteEntries.push({ num, html: content });

    const marker = document.createElement('a');
    marker.className = 'fn-inline-marker';
    marker.textContent = String(num);
    marker.href = `#fn-${num}`;
    marker.id = `fn-ref-${num}`;
    marker.setAttribute('aria-label', `Footnote ${num}`);

    this.appendChild(marker);

    queueFootnoteRender();
  }
}

let footnoteRenderQueued = false;
function queueFootnoteRender(): void {
  if (footnoteRenderQueued) return;
  footnoteRenderQueued = true;
  requestAnimationFrame(() => {
    renderFootnoteList();
    footnoteRenderQueued = false;
  });
}

function renderFootnoteList(): void {
  let list = document.querySelector('.d-footnote-list');
  if (!list) {
    list = document.createElement('ol');
    list.className = 'd-footnote-list';
    const article = document.querySelector('.article');
    if (article) {
      const refsSection = document.getElementById('sec-references');
      if (refsSection) {
        article.insertBefore(list, refsSection);
      } else {
        article.appendChild(list);
      }
    }
  }
  list.innerHTML = '';
  for (const entry of footnoteEntries) {
    const li = document.createElement('li');
    li.id = `fn-${entry.num}`;
    li.dataset.fnNum = String(entry.num);
    li.innerHTML =
      entry.html +
      ` <a href="#fn-ref-${entry.num}" class="fn-backref" aria-label="Back to text">↩</a>`;
    list.appendChild(li);
  }
}

if (!customElements.get('d-footnote')) {
  customElements.define('d-footnote', DFootnote);
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
