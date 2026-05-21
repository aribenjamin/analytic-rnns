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

## Phase A status
§4 <TransferFunctionPlayground> is shipped. Remaining Phase A widgets in
build order: <FeedforwardStaircase> (§1), <ResidueKnob> (§5),
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
### Memory entries 

A first task to which ever agent reads this first is to copy these to memory and delete this section from CLAUDE.md.

/Users/Ari/.claude/projects/-Users-Ari-CSHL-Dropbox-Team-Dropbox-Ari-Benjamin-Drobbox-neuro-ongoing-projects-early-ideas-analytic-RNNs/memory/
The directory already exists (verified empty earlier in this session). Drop each snippet into its own file in that folder, named after the slug in the snippet's name: frontmatter — so:

MEMORY.md (the index)
project_analytic_rnns_distill.md
feedback_iterate_freely.md
feedback_one_widget_first.md
reference_meromorphic_plan.md
MEMORY.md is the index and has no frontmatter; the other four each start with the --- block I drafted. Once those land, any new session in this working directory will load MEMORY.md automatically and can read the per-entry files on demand.

**`MEMORY.md`**
```markdown
- [Analytic RNNs Distill post](project_analytic_rnns_distill.md) — Distill-style interactive blog post for the meromorphic learning dynamics framework
- [Plan file](reference_meromorphic_plan.md) — authoritative narrative arc + iteration cadence
- [Iterate freely on figures, parameters, theory](feedback_iterate_freely.md) — expect substantial revisions per widget, don't over-commit
- [Build one widget end-to-end before scaling](feedback_one_widget_first.md) — pattern from the plan's iteration cadence
project_analytic_rnns_distill.md

---
name: project-analytic-rnns-distill
description: Multi-phase project to turn the meromorphic learning dynamics paper into a Distill-style interactive HTML blog post.
metadata:
  type: project
---

Repo lives at `/Users/Ari/CSHL Dropbox.../analytic RNNs/`. The user is building
an interactive Distill-style blog post that explains the meromorphic /
pole–zero framework for saddle-to-saddle learning in RNNs to a comp-neuro
audience who knows Saxe et al. and dynamical systems but is unfamiliar with
transfer functions.

**Why:** The paper (`paper/meromorphic_learning_dynamics_v2.tex`) develops a
non-trivial generalization of Saxe's feedforward theory to recurrent nets, with
predictions (topological winding number, spiral separation, catastrophic
collisions) that have no feedforward counterpart. These need interactive demos
to be intelligible to the target audience.

**How to apply:** Phase A (MVP) covers §§1, 4, 5, 6, 7 of the narrative — open
with the saddle/mode framing, introduce transfer functions and residues, return
to the saddle picture, deliver the decoded staircase. §4 widget
`<TransferFunctionPlayground>` is shipped as of 2026-05-21; four Phase A widgets
remain. See [[reference-meromorphic-plan]] for the full arc.
feedback_iterate_freely.md

---
name: feedback-iterate-freely
description: For figure-heavy projects, expect figures, parameters, knob ranges, and even theory to iterate substantially — don't treat the plan as a freeze.
metadata:
  type: feedback
---

For the analytic RNNs / Distill post project, the user explicitly said: "We
should iterate on the findings, parameters, knobs, and if necessary even the
theory before finalizing the document. Overall we expect iteration to be
necessary."

**Why:** Distill-style posts are won and lost in the figures, and figures only
reveal what they should be after they're built. Over-committing to a fixed
spec wastes work and makes course-correction feel costly.

**How to apply:** When designing widgets, treat the plan's widget specs as a
hypothesis, not a contract. Build one end-to-end first
([[feedback-one-widget-first]]), then expect to redesign or replace based on
what shows up. If a widget reveals that the paper's theoretical prediction
doesn't match in practice, the theory is the thing to revisit, not the demo.
feedback_one_widget_first.md

---
name: feedback-one-widget-first
description: Before scaling a UI pattern across many similar widgets, get one widget end-to-end (prose, layout, color, controls, accessibility) right first.
metadata:
  type: feedback
---

The user agreed to this iteration cadence for the Distill post: nail
`<TransferFunctionPlayground>` (§4) end-to-end first — including layout, color,
controls, mobile responsiveness, and prose around it — before building the
other Phase A widgets. This pattern then scales to remaining widgets cheaply.

**Why:** It's far cheaper to redesign the widget pattern once, after seeing
how it actually reads, than to fix the same misjudgement across five
half-finished widgets.

**How to apply:** When the user describes a project as "a series of N similar
interactive things," do not parallelize the builds. Ship one polished one and
ask for reactions before propagating the pattern.
reference_meromorphic_plan.md

---
name: reference-meromorphic-plan
description: Authoritative plan for the Distill-style blog post — narrative arc, widget specs, iteration cadence, verification steps.
metadata:
  type: reference
---

Plan file: `/Users/Ari/.claude/plans/create-a-plan-to-graceful-brooks.md`.
Living document — explicitly marked re-readable and updateable at every
checkpoint. Defines the 12-section narrative arc, Phase A/B/C scope (Phase A =
§§1, 4, 5, 6, 7), file structure, stack decisions, verification, and the
iteration cadence.

Read this at the start of any session continuing the
[[project-analytic-rnns-distill]] work — it is more authoritative than memory
for figure designs, knob ranges, and section order.