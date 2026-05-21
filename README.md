# Modes, residues, and the meromorphic geometry of recurrent learning

An interactive [Distill](https://distill.pub)-style blog post for the
*Meromorphic Learning Dynamics* framework. See [paper/proposed_figures.md](paper/proposed_figures.md)
for the figure roadmap and [paper/meromorphic_learning_dynamics_v2.tex](paper/meromorphic_learning_dynamics_v2.tex)
for the underlying theory.

## Local development

```sh
npm install
npm run dev
```

Open <http://localhost:5173>. Edits to `src/` hot-reload.

## Build and deploy

```sh
VITE_BASE_PATH=/<repo-name>/ npm run build
```

Produces a static site in `dist/`. The included GitHub Action
(`.github/workflows/deploy.yml`) handles this on every push to `main` and
publishes to the `gh-pages` branch.

## Layout

```
src/
  main.ts                 # mounts Svelte widgets into <div id="widget-*"> slots
  widgets/                # one .svelte file per interactive figure
  lib/                    # numerical core (RNN, transfer function, gradient flow)
    plots/                # reusable D3 plot building blocks (ZPlane, Bode, …)
  styles/                 # article and widget CSS
python/                   # NumPy reference implementation + parity test
public/data/              # precomputed JSON trajectories for heavier demos
paper/                    # LaTeX source and figure roadmap
```

## Tests

```sh
npm test                  # unit tests for src/lib/
pytest python/tests       # cross-language parity test
```
