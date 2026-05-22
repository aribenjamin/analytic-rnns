/*
 * Direct (W, b, c) gradient flow for the §7 DecodedStaircase widget.
 *
 *   System:    h_{t+1} = W h_t + b x_t,    y_t = cᵀ h_{t+1}
 *   Loss:      L = ½ Σ_{t=0}^{T-1} (y_t − g*_t)²    with x = δ[0]
 *   Adjoint:   λ_{T+1} = 0
 *              λ_{t+1} = e_t c + Wᵀ λ_{t+2}      for t = T−1, …, 0
 *   Grads:     dL/dW  = Σ_{t=0}^{T-1} λ_{t+1} h_tᵀ      (h_0 = 0, so the t=0
 *                                                        outer product
 *                                                        contributes nothing)
 *              dL/db  = λ_1                              (impulse only at t=0)
 *              dL/dc  = Σ_{t=0}^{T-1} e_t h_{t+1}
 *
 * Random target: drawn in modal coordinates (kept compatible with the existing
 * ModalTarget/ModalState rendering path) — random mix of real and complex-pair
 * modes with random poles and residue magnitudes. The student is full
 * (W, b, c) parameterisation; eigenvalues of W *drift* during training, which
 * is the new pedagogical content of this widget compared to the modal Phase-A
 * version.
 *
 * Worker-safe: no DOM, no globals beyond seeded PRNG; all state is plain JSON.
 */

import { type LinearRNN, makeRNN } from './rnn';
import {
  type Mode,
  type ModalState,
  type ModalTarget,
  type TraceSnapshot,
  impulseResponseOfModes,
  modeEffectiveRank,
} from './gradientFlow';
import { modalSystemFromWBC } from './eigSmall';
import type { Complex } from './complex';

// ──────────────────────────────────────────────────────────────────────
// Deterministic PRNG + Gaussian
// ──────────────────────────────────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGauss(rand: () => number): () => number {
  return () => {
    const u1 = Math.max(1e-12, rand());
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

// ──────────────────────────────────────────────────────────────────────
// Random target generation (modal coordinates)
// ──────────────────────────────────────────────────────────────────────

export interface RandomTargetOpts {
  /** Total state dimension (= # real modes + 2 × # pair modes). Default 4. */
  totalDim?: number;
  /** Horizon for the impulse-response target g*. */
  T?: number;
  /** Random seed. */
  seed?: number;
}

/** Pick a random ModalTarget — random mix of real and complex-pair modes with
 *  poles inside the unit disk and residue magnitudes spread on a log scale.
 *  The staircase pedagogy benefits from poles separated in radius, so radii
 *  are stratified per-mode.
 */
export function randomTarget(opts: RandomTargetOpts = {}): ModalTarget {
  const totalDim = opts.totalDim ?? 4;
  const T = opts.T ?? 160;
  const rand = mulberry32(opts.seed ?? 0xBEEF);

  // Decide composition: each "slot" of 1 (real) or 2 (pair) costs that many
  // dimensions. We lean slightly toward 1–2 complex pairs for visual variety.
  const modes: Mode[] = [];
  let left = totalDim;
  while (left > 0) {
    const wantPair = left >= 2 && rand() < 0.55;
    if (wantPair) {
      const mag = 0.45 + 0.45 * rand();
      const arg = (0.18 + 0.72 * rand()) * Math.PI;
      // Residue: random magnitude (log-uniform) with random phase.
      const rMag = Math.exp(Math.log(0.3) + (Math.log(1.6) - Math.log(0.3)) * rand());
      const rPhase = 2 * Math.PI * rand();
      // Split symmetrically as α = β = √r (principal sqrt).
      const sqrtMag = Math.sqrt(rMag);
      const alpha: Complex = {
        re: sqrtMag * Math.cos(rPhase / 2),
        im: sqrtMag * Math.sin(rPhase / 2),
      };
      modes.push({
        kind: 'pair',
        p: { re: mag * Math.cos(arg), im: mag * Math.sin(arg) },
        alpha,
        beta: { ...alpha },
      });
      left -= 2;
    } else {
      const sign = rand() < 0.4 ? -1 : 1;
      const mag = 0.18 + 0.74 * rand();
      const rMag = Math.exp(Math.log(0.3) + (Math.log(1.6) - Math.log(0.3)) * rand());
      const sqrtR = Math.sqrt(rMag) * (rand() < 0.5 ? -1 : 1);
      modes.push({
        kind: 'real',
        p: sign * mag,
        alpha: sqrtR,
        beta: sqrtR,
      });
      left -= 1;
    }
  }

  const gStar = impulseResponseOfModes(modes, T);
  return { modes, gStar, T };
}

/** Stable count of state dimensions covered by a Mode list. */
export function totalDimOfModes(modes: Mode[]): number {
  let n = 0;
  for (const m of modes) n += m.kind === 'real' ? 1 : 2;
  return n;
}

// ──────────────────────────────────────────────────────────────────────
// (W, b, c) initialisation
// ──────────────────────────────────────────────────────────────────────

/** Gaussian-random W, b, c with all entries scaled by `scale`. */
export function initWBC(n: number, scale: number, seed: number): LinearRNN {
  const rnn = makeRNN(n);
  const rand = mulberry32(seed);
  const gauss = makeGauss(rand);
  for (let i = 0; i < n * n; i++) rnn.W[i] = scale * gauss();
  for (let i = 0; i < n; i++) rnn.b[i] = scale * gauss();
  for (let i = 0; i < n; i++) rnn.c[i] = scale * gauss();
  return rnn;
}

// ──────────────────────────────────────────────────────────────────────
// Forward + impulse response
// ──────────────────────────────────────────────────────────────────────

/** Impulse response g_t = cᵀ Wᵗ b for t = 0..T-1, plus the full hidden-state
 *  trajectory h_1..h_T (needed by the BPTT backward pass).
 *  Storage layout: states[t·n + i] holds (h_{t+1})_i; states has length T·n. */
function forwardImpulse(
  rnn: LinearRNN,
  T: number,
): { g: Float64Array; states: Float64Array } {
  const { n, W, b, c } = rnn;
  const g = new Float64Array(T);
  const states = new Float64Array(T * n);
  const h = new Float64Array(n);
  const hNext = new Float64Array(n);
  for (let t = 0; t < T; t++) {
    // hNext = W h + b · δ[t,0]
    const xt = t === 0 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      let s = b[i] * xt;
      const row = i * n;
      for (let j = 0; j < n; j++) s += W[row + j] * h[j];
      hNext[i] = s;
    }
    let yt = 0;
    for (let i = 0; i < n; i++) yt += c[i] * hNext[i];
    g[t] = yt;
    for (let i = 0; i < n; i++) states[t * n + i] = hNext[i];
    // double-buffer
    for (let i = 0; i < n; i++) h[i] = hNext[i];
  }
  return { g, states };
}

// ──────────────────────────────────────────────────────────────────────
// BPTT gradient
// ──────────────────────────────────────────────────────────────────────

export interface WBCGrads {
  loss: number;
  dW: Float64Array;
  db: Float64Array;
  dc: Float64Array;
}

export function gradientWBC(rnn: LinearRNN, gStar: readonly number[]): WBCGrads {
  const { n, W, c } = rnn;
  const T = gStar.length;
  const { g, states } = forwardImpulse(rnn, T);

  // Errors and loss.
  const e = new Float64Array(T);
  let loss = 0;
  for (let t = 0; t < T; t++) {
    e[t] = g[t] - gStar[t];
    loss += e[t] * e[t];
  }
  loss *= 0.5;

  const dW = new Float64Array(n * n);
  const db = new Float64Array(n);
  const dc = new Float64Array(n);

  // Backward pass.
  // λ_{t+1} is the gradient of L w.r.t. h_{t+1}. Recurrence:
  //   λ_{T} = e_{T-1} · c
  //   λ_{t+1} = e_t · c + Wᵀ λ_{t+2}     for t = T−2, …, 0
  // dW += λ_{t+1} h_tᵀ (h_0 = 0, so t=0 outer product is 0)
  // db = λ_1
  // dc += e_t · h_{t+1}

  const lambdaNext = new Float64Array(n);   // λ_{t+2}
  const lambda = new Float64Array(n);       // λ_{t+1}
  const hPrev = new Float64Array(n);        // h_t (for outer product)

  for (let t = T - 1; t >= 0; t--) {
    // lambda = e[t] * c + Wᵀ · lambdaNext
    for (let i = 0; i < n; i++) {
      let s = e[t] * c[i];
      for (let j = 0; j < n; j++) s += W[j * n + i] * lambdaNext[j];
      lambda[i] = s;
    }
    // dc += e[t] * h_{t+1}
    for (let i = 0; i < n; i++) dc[i] += e[t] * states[t * n + i];

    // h_t for outer product: h_t = states[(t-1)*n + ...] for t ≥ 1, else 0.
    if (t === 0) {
      for (let i = 0; i < n; i++) hPrev[i] = 0;
      // db = λ_1
      for (let i = 0; i < n; i++) db[i] = lambda[i];
    } else {
      for (let i = 0; i < n; i++) hPrev[i] = states[(t - 1) * n + i];
    }
    // dW += λ_{t+1} · h_tᵀ
    for (let i = 0; i < n; i++) {
      const li = lambda[i];
      if (li === 0) continue;
      const row = i * n;
      for (let j = 0; j < n; j++) dW[row + j] += li * hPrev[j];
    }

    for (let i = 0; i < n; i++) lambdaNext[i] = lambda[i];
  }

  return { loss, dW, db, dc };
}

// ──────────────────────────────────────────────────────────────────────
// Step
// ──────────────────────────────────────────────────────────────────────

export function stepWBC(rnn: LinearRNN, gStar: readonly number[], dt: number): {
  rnn: LinearRNN;
  loss: number;
} {
  const grads = gradientWBC(rnn, gStar);
  const out = makeRNN(rnn.n);
  for (let i = 0; i < rnn.W.length; i++) out.W[i] = rnn.W[i] - dt * grads.dW[i];
  for (let i = 0; i < rnn.b.length; i++) out.b[i] = rnn.b[i] - dt * grads.db[i];
  for (let i = 0; i < rnn.c.length; i++) out.c[i] = rnn.c[i] - dt * grads.dc[i];
  return { rnn: out, loss: grads.loss };
}

// ──────────────────────────────────────────────────────────────────────
// Projection (W,b,c) → ModalState
// ──────────────────────────────────────────────────────────────────────

/** Project the live (W, b, c) into the (poles, residues) → ModalState form
 *  that the §7 widget already renders. We split each complex residue
 *  symmetrically as α = β = √r (principal sqrt) — only the product α·β = r
 *  is observable in the panels.
 *
 *  If two eigenvalues coincide and the Vandermonde solve becomes singular,
 *  modalSystemFromWBC returns zero residues; the projection then represents
 *  a temporarily-silent system, which renders as faint markers. The next
 *  snapshot recovers as the eigenvalues separate again. */
export function projectToModalState(rnn: LinearRNN): ModalState {
  const sys = modalSystemFromWBC(rnn.W, rnn.b, rnn.c, rnn.n);
  const modes: Mode[] = [];
  const used = new Array<boolean>(sys.poles.length).fill(false);
  for (let i = 0; i < sys.poles.length; i++) {
    if (used[i]) continue;
    const p = sys.poles[i];
    const r = sys.residues[i];
    if (Math.abs(p.im) < 1e-9) {
      // Real mode. Residue should also be real; take its real part.
      const rval = r.re;
      const sgn = rval >= 0 ? 1 : -1;
      const ab = Math.sqrt(Math.abs(rval));
      modes.push({ kind: 'real', p: p.re, alpha: sgn * ab, beta: ab });
      used[i] = true;
    } else {
      // Find conjugate partner.
      let pj = -1;
      let bestDist = Infinity;
      for (let j = 0; j < sys.poles.length; j++) {
        if (j === i || used[j]) continue;
        const d = Math.hypot(sys.poles[j].re - p.re, sys.poles[j].im + p.im);
        if (d < bestDist) {
          bestDist = d;
          pj = j;
        }
      }
      const useUpper = p.im > 0;
      const pole = useUpper ? p : (pj >= 0 ? sys.poles[pj] : { re: p.re, im: -p.im });
      const res = useUpper ? r : (pj >= 0 ? sys.residues[pj] : { re: r.re, im: -r.im });
      const sqrtR = csqrtPrincipal(res);
      modes.push({ kind: 'pair', p: pole, alpha: sqrtR, beta: { ...sqrtR } });
      used[i] = true;
      if (pj >= 0) used[pj] = true;
    }
  }
  return { modes };
}

function csqrtPrincipal(z: Complex): Complex {
  const r = Math.hypot(z.re, z.im);
  const phi = Math.atan2(z.im, z.re) / 2;
  const m = Math.sqrt(r);
  return { re: m * Math.cos(phi), im: m * Math.sin(phi) };
}

// ──────────────────────────────────────────────────────────────────────
// Trajectory
// ──────────────────────────────────────────────────────────────────────

export interface DirectSimOptions {
  dt: number;
  steps: number;
  snapshots?: number;
  rhoThreshold?: number;
}

export function simulateTrajectoryWBC(
  rnn0: LinearRNN,
  target: ModalTarget,
  opts: DirectSimOptions,
): TraceSnapshot[] {
  const N = opts.snapshots ?? 240;
  const total = opts.steps;
  const threshold = opts.rhoThreshold ?? 1e-2;

  // Log-spaced snapshot schedule, mirroring gradientFlow.simulateTrajectory.
  const snapAt = new Set<number>();
  snapAt.add(0);
  for (let i = 0; i < N; i++) {
    const frac = i / (N - 1);
    const idx = Math.max(1, Math.round(Math.exp(frac * Math.log(total))));
    snapAt.add(Math.min(total, idx));
  }

  const out: TraceSnapshot[] = [];
  let rnn = rnn0;
  // Initial loss + state.
  let { loss } = gradientWBC(rnn, target.gStar);
  let state = projectToModalState(rnn);
  out.push({
    tau: 0,
    loss: Math.max(loss, 1e-30),
    rho: modeEffectiveRank(state, threshold),
    state,
  });

  for (let n = 1; n <= total; n++) {
    const r = stepWBC(rnn, target.gStar, opts.dt);
    rnn = r.rnn;
    loss = r.loss;
    if (snapAt.has(n)) {
      state = projectToModalState(rnn);
      out.push({
        tau: n,
        loss: Math.max(loss, 1e-30),
        rho: modeEffectiveRank(state, threshold),
        state,
      });
    }
  }
  return out;
}
