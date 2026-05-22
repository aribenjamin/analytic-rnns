# CLAUDE.md

This repo is an interactive Distill-style HTML blog post that demonstrates the
**meromorphic learning dynamics** framework for recurrent neural networks. The
framework's central idea: replace Saxe et al.'s singular values with pole–zero
configurations in C, so the saddle-to-saddle picture of learning generalises
from feedforward to recurrent networks. The audience is comp-neuro readers who
know analytic studies of DNNs (Saxe) and dynamical systems, but have **never
thought about transfer functions** — so transfer functions are introduced
gently with an interactive playground.

The authoritative plan, narrative arc, and iteration cadence live in:

- /Users/Ari/.claude/plans/create-a-plan-to-graceful-brooks.md

The plan is **explicitly a living document**: figures, parameters, knob ranges,
and even the underlying theory are expected to iterate as widgets get built and
exercised. Re-read the plan at every checkpoint; update it when the structure
turns out to be wrong.

## File layout
paper/ # LaTeX source, PDF, figure roadmap (proposed_figures.md)
index.html # article shell; <d-article> + widget mount points
src/
main.ts # registers Svelte widgets into <div id="widget-*"> slots
lib/
complex.ts # Complex arithmetic + polynomial helpers
polyRoots.ts # Durand-Kerner polynomial root finder
transferFn.ts # H(z), residues, zeros, frequency/impulse response in modal coords
rnn.ts # direct (W, b, c) SISO recurrence
plots/ # reusable D3 components: ZPlane, BodePlot, TimeSeries
mount.ts # data-attribute -> props helper for widget mounting
widgets/ # one .svelte file per interactive figure
styles/ # article.css (typography) + widgets.css (controls/markers)
python/ # NumPy reference implementation
public/data/ # gzipped JSON trajectories for precomputed heavy demos
.github/workflows/ # GitHub Pages deploy

## Stack and load-bearing decisions
- **Vite + Svelte 4 + TypeScript.** Svelte 4 (not 5) — distill-template's
  2020-era custom elements have unverified interaction with Svelte 5 runes.
- **distill-template loaded from CDN**, not a local fork.
- **D3 v7 for SVG plots.** Canvas where SVG cost is too high.
- **KaTeX auto-render** for math.
- **No eigendecomposition library** for Phase A. All widgets are parameterised
  in **modal coordinates** (poles, residues) directly — this avoids eigen-js /
  WASM / complex-eigenvalue extraction entirely. Phase B/C may need (W, b, c)
  gradient flow; that's when we reopen eigen-js vs hand-rolled-QR.
- **Mobile is desktop-first / mobile-acceptable.** Each widget includes a
  max-width: 720px CSS branch; verify at 375 px before declaring done.
- **Conjugate-locking** in ZPlane.ts: dragging one pole of a complex pair moves
  its conjugate partner automatically. Id convention: `pole-k` and `pole-k-conj`.
## Commands
```sh
npm install
npm run dev                  # http://localhost:5173
npm test                     # vitest run
npm run check                # svelte-check
npm run build                # dist/
VITE_BASE_PATH=/<repo>/ npm run build   # for GitHub Pages subdir hosting
```

Hand-derive new math first, write the test, then implement. The numerical core
currently has 18 passing tests in src/lib/*.test.ts.

## Previewing (worktrees + verification)

`preview_start` **reuses whatever dev server is already bound to the port in
`.claude/launch.json`.** If that port belongs to another checkout (the main
repo or a sibling worktree), you silently preview the *wrong files* —
`preview_eval` and screenshots still look plausible because they hit a real
server, just not yours. This is the recurring trap.

- `.claude/launch.json` is git-ignored so every checkout owns its port; the
  main repo uses 5180.
- In a worktree, run `npm run preview:port` once before `preview_start`. It
  takes the lowest free port ≥ 5181, rewrites `.claude/launch.json`, and the
  server then starts with `--strictPort` — it binds that exact port or fails
  loudly, never silently landing on someone else's server.
- Then `preview_start "dev"`.

Verify widgets with `preview_snapshot` (text, roles, structure) or
`preview_eval` (query the live DOM — widgets are `[id^="widget-"]`). Both are
reliable and scroll-independent. **Do not trust `preview_screenshot` here:** in
this preview environment the screenshot capture is decoupled from
`preview_eval`'s scroll, so a mid-article widget photographs as a blank cream
rectangle even when it rendered correctly. A blank screenshot is not evidence
of a broken widget — check `preview_snapshot` before concluding anything.

## Phase A status
§4 <TransferFunctionPlayground> and §5 <ResidueKnob> are shipped. Remaining
Phase A widgets in build order: <FeedforwardStaircase> (§1),
<SaddleLandscape> (§6), <DecodedStaircase> (§7). After Phase A, do a full
read-through with widgets in place and expect a substantial revision pass —
the Phase A checkpoint defined in the plan's Iteration Plan section.

## Conventions
TypeScript strict mode. No any. New numerical code adds a .test.ts.
No comments restating what the code does. Only when the why is non-obvious.
Widgets are isolated by default; cross-widget state goes through src/stores/
only when prose pedagogically motivates it.
Commit per widget. The scaffolding + numerical core + §4 widget that already
exist deserve one consolidated "milestone" commit on explicit go-ahead
(currently uncommitted by design).
