/*
 * Tiny helper that mounts a Svelte component into a target element by id, and
 * passes the element's data-* attributes as props. Lets us configure a widget
 * from index.html via data-attributes:
 *
 *   <div id="widget-foo" class="widget-slot" data-n="5"></div>
 *
 * becomes a Foo component mounted with props { n: 5 } (numbers, booleans, and
 * JSON-parseable strings are auto-coerced).
 */

type SvelteComponent = new (opts: { target: Element; props?: Record<string, unknown> }) => unknown;

function coerce(value: string): unknown {
  if (value === 'true') return true;
  if (value === 'false') return false;
  const asNumber = Number(value);
  if (!Number.isNaN(asNumber) && value.trim() !== '') return asNumber;
  // Try JSON for objects/arrays.
  if (value.startsWith('{') || value.startsWith('[')) {
    try {
      return JSON.parse(value);
    } catch {
      /* fall through */
    }
  }
  return value;
}

export function mount(slotId: string, Component: SvelteComponent): unknown | null {
  const el = document.getElementById(slotId);
  if (!el) {
    console.warn(`[mount] no element with id="${slotId}" — skipping widget`);
    return null;
  }
  const props: Record<string, unknown> = {};
  for (const attr of Array.from(el.attributes)) {
    if (attr.name.startsWith('data-')) {
      const key = attr.name.slice('data-'.length).replace(/-([a-z])/g, (_, c: string) =>
        c.toUpperCase(),
      );
      props[key] = coerce(attr.value);
    }
  }
  return new Component({ target: el, props });
}
