/*
 * Direct (W, b, c) gradient flow for the §7 DecodedStaircase widget.
 *
 *   System:    h_{t+1} = W h_t + b x_t,    y_t = cᵀ h_{t+1}
 *   Loss:      L = ½ Σ_{t=0}^{T-1} (y_t − y*_t)²
 *   Adjoint:   λ_{T+1} = 0
 *              λ_{t+1} = e_t c + Wᵀ λ_{t+2}      for t = T−1, …, 0
 *   Grads:     dL/dW  = Σ_{t=0}^{T-1} λ_{t+1} h_tᵀ      (h_0 = 0, so the t=0
 *                                                        outer product
 *                                                        contributes nothing)
 *              dL/db  = Σ_{t=0}^{T-1} x_t λ_{t+1}
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
// Input sequences for the (W, b, c) trainer
// ──────────────────────────────────────────────────────────────────────

export type InputKind = 'impulse' | 'white' | 'pink';

/** Scale so Σ x_t² = 1 — i.e. the input has the same total energy as the
 *  unit impulse. This keeps the gradient magnitudes comparable to impulse
 *  training, so the same `dt` works for all input regimes. */
function normalizeToUnitNorm(x: number[]): number[] {
  let s2 = 0;
  for (const v of x) s2 += v * v;
  const norm = Math.sqrt(s2);
  if (norm === 0 || !Number.isFinite(norm)) return x;
  return x.map((v) => v / norm);
}

/** Length-T Gaussian white noise, normalized to unit norm (Σ x² = 1). */
export function whiteNoiseInput(T: number, seed: number): number[] {
  const gauss = makeGauss(mulberry32(seed));
  const x = new Array<number>(T);
  for (let t = 0; t < T; t++) x[t] = gauss();
  return normalizeToUnitNorm(x);
}

/** Length-T 1/f (pink) noise via Hermitian-symmetric spectrum construction:
 *  build half-spectrum with magnitudes ∝ 1/√k from independent complex
 *  Gaussian coefficients, mirror as conjugates, IDFT, normalize to unit norm
 *  (Σ x² = 1). DC is forced to zero so the input is mean-centred. */
export function pinkNoiseInput(T: number, seed: number): number[] {
  const gauss = makeGauss(mulberry32(seed));
  const re = new Array<number>(T).fill(0);
  const im = new Array<number>(T).fill(0);
  const half = Math.floor(T / 2);
  const SQRT_HALF = Math.SQRT1_2;
  for (let k = 1; k <= half; k++) {
    const scale = 1 / Math.sqrt(k);
    if (k === T - k) {
      // Nyquist bin (only when T even): must be real.
      re[k] = gauss() * scale;
      im[k] = 0;
    } else {
      re[k] = gauss() * scale * SQRT_HALF;
      im[k] = gauss() * scale * SQRT_HALF;
      re[T - k] = re[k];
      im[T - k] = -im[k];
    }
  }
  const out = new Array<number>(T).fill(0);
  for (let n = 0; n < T; n++) {
    let s = 0;
    const twoPiN = (2 * Math.PI * n) / T;
    for (let k = 0; k < T; k++) {
      const a = twoPiN * k;
      s += re[k] * Math.cos(a) - im[k] * Math.sin(a);
    }
    out[n] = s;
  }
  return normalizeToUnitNorm(out);
}

export function inputFromKind(kind: InputKind, T: number, seed: number): number[] {
  if (kind === 'impulse') return impulseInput(T);
  if (kind === 'white') return whiteNoiseInput(T, seed);
  return pinkNoiseInput(T, seed);
}

/** y[t] = Σ_{k=0..t} g[t-k] · u[k]. For LTI systems with impulse response g
 *  and h_0 = 0, this is exactly the target's output to input u. */
export function convolveCausal(g: readonly number[], u: readonly number[]): number[] {
  const T = u.length;
  if (g.length !== T) {
    throw new Error(`convolveCausal: g length ${g.length} ≠ u length ${T}`);
  }
  const out = new Array<number>(T).fill(0);
  for (let t = 0; t < T; t++) {
    let s = 0;
    for (let k = 0; k <= t; k++) s += g[t - k] * u[k];
    out[t] = s;
  }
  return out;
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

/** Forward pass under arbitrary input x_t. Returns the output y_t = cᵀ h_{t+1}
 *  along with the full hidden-state trajectory h_1..h_T (needed by BPTT).
 *  Storage layout: states[t·n + i] holds (h_{t+1})_i; states has length T·n. */
function forwardOnInput(
  rnn: LinearRNN,
  x: readonly number[],
): { y: Float64Array; states: Float64Array } {
  const { n, W, b, c } = rnn;
  const T = x.length;
  const y = new Float64Array(T);
  const states = new Float64Array(T * n);
  const h = new Float64Array(n);
  const hNext = new Float64Array(n);
  for (let t = 0; t < T; t++) {
    const xt = x[t];
    for (let i = 0; i < n; i++) {
      let s = b[i] * xt;
      const row = i * n;
      for (let j = 0; j < n; j++) s += W[row + j] * h[j];
      hNext[i] = s;
    }
    let yt = 0;
    for (let i = 0; i < n; i++) yt += c[i] * hNext[i];
    y[t] = yt;
    for (let i = 0; i < n; i++) states[t * n + i] = hNext[i];
    for (let i = 0; i < n; i++) h[i] = hNext[i];
  }
  return { y, states };
}

function impulseInput(T: number): number[] {
  const x = new Array<number>(T).fill(0);
  x[0] = 1;
  return x;
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

export function gradientWBC(
  rnn: LinearRNN,
  input: readonly number[],
  yStar: readonly number[],
): WBCGrads {
  const { n, W, c } = rnn;
  const T = yStar.length;
  if (input.length !== T) {
    throw new Error(`gradientWBC: input length ${input.length} ≠ yStar length ${T}`);
  }
  const { y, states } = forwardOnInput(rnn, input);

  const e = new Float64Array(T);
  let loss = 0;
  for (let t = 0; t < T; t++) {
    e[t] = y[t] - yStar[t];
    loss += e[t] * e[t];
  }
  loss *= 0.5;

  const dW = new Float64Array(n * n);
  const db = new Float64Array(n);
  const dc = new Float64Array(n);

  // λ_{t+1} = e_t c + Wᵀ λ_{t+2}, with λ_{T+1} = 0.
  const lambdaNext = new Float64Array(n);
  const lambda = new Float64Array(n);
  const hPrev = new Float64Array(n);

  for (let t = T - 1; t >= 0; t--) {
    for (let i = 0; i < n; i++) {
      let s = e[t] * c[i];
      for (let j = 0; j < n; j++) s += W[j * n + i] * lambdaNext[j];
      lambda[i] = s;
    }
    for (let i = 0; i < n; i++) dc[i] += e[t] * states[t * n + i];

    const xt = input[t];
    for (let i = 0; i < n; i++) db[i] += xt * lambda[i];

    if (t === 0) {
      for (let i = 0; i < n; i++) hPrev[i] = 0;
    } else {
      for (let i = 0; i < n; i++) hPrev[i] = states[(t - 1) * n + i];
    }
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

export function stepWBC(
  rnn: LinearRNN,
  input: readonly number[],
  yStar: readonly number[],
  dt: number,
): { rnn: LinearRNN; loss: number } {
  const grads = gradientWBC(rnn, input, yStar);
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
  /** Input sequence. Defaults to the unit impulse. */
  input?: number[];
  /** Target output for the chosen input. Defaults to target.gStar (impulse
   *  response of the teacher), which is correct when input is the impulse. */
  yStar?: number[];
}

export function simulateTrajectoryWBC(
  rnn0: LinearRNN,
  target: ModalTarget,
  opts: DirectSimOptions,
): TraceSnapshot[] {
  const N = opts.snapshots ?? 240;
  const total = opts.steps;
  const threshold = opts.rhoThreshold ?? 1e-2;
  const T = target.gStar.length;
  const input = opts.input ?? impulseInput(T);
  const yStar = opts.yStar ?? target.gStar;

  const snapAt = new Set<number>();
  snapAt.add(0);
  for (let i = 0; i < N; i++) {
    const frac = i / (N - 1);
    const idx = Math.max(1, Math.round(Math.exp(frac * Math.log(total))));
    snapAt.add(Math.min(total, idx));
  }

  const out: TraceSnapshot[] = [];
  let rnn = rnn0;
  let { loss } = gradientWBC(rnn, input, yStar);
  let state = projectToModalState(rnn);
  out.push({
    tau: 0,
    loss: Math.max(loss, 1e-30),
    rho: modeEffectiveRank(state, threshold),
    state,
  });

  for (let n = 1; n <= total; n++) {
    const r = stepWBC(rnn, input, yStar, opts.dt);
    rnn = r.rnn;
    loss = r.loss;
    if (!Number.isFinite(loss)) break;
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
