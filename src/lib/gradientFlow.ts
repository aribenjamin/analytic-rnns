/*
 * Gradient flow on a SISO transfer function in modal coordinates with the
 * residues in *factored* form  r_k = α_k β_k.  This factorisation is the
 * source of the saddle at r = 0:  Theorem 5.1 of the paper writes
 *   α_k = c^⊤ v_k    (read-out coupling to the k-th eigenvector)
 *   β_k = u_k^* b    (input drive of the k-th eigenvector)
 * so when either α or β vanishes the mode is silent *and* the gradient at
 * that point vanishes in the silent factor.  That bilinear structure is
 * exactly the Saxe feedforward-staircase mechanism, just dressed in
 * complex coordinates.  Small (α,β) initialisation → sigmoidal mode
 * activation with escape time ∝ log(1/init)/λ_k → a stepped loss curve.
 *
 * A "mode" is either
 *   - a real mode: real pole p with α, β ∈ ℝ; contributes (αβ) p^t to g_t;
 *   - a complex-conjugate pair: pole p with Im p > 0, α, β ∈ ℂ; the
 *     partner (p̄, ᾱ, β̄) is implicit. Contributes 2 Re(αβ p^t) to g_t.
 *
 * In Phase A the poles are held fixed at their target locations; only the
 * (α, β) factors are gradient-flowed.  This is the cleanest expression of
 * the staircase and matches the §7 narrative ("each cliff is one pole–zero
 * pair separating in the complex plane" — i.e., residue growing away from
 * zero, equivalently the numerator zero leaving its pole).
 *
 * This file is worker-safe (plain JSON-able state, no DOM).
 */

import type { Complex } from './complex';
import { abs, mul, add, scale, conj } from './complex';
import type { ModalSystem } from './transferFn';

export type Mode =
  | { kind: 'real'; p: number; alpha: number; beta: number }
  | { kind: 'pair'; p: Complex; alpha: Complex; beta: Complex };

export interface ModalState {
  modes: Mode[];
}

export interface ModalTarget {
  /** Target modes carry α, β as well; the visible residue is α β. */
  modes: Mode[];
  gStar: number[];
  T: number;
}

export interface InitOptions {
  scale?: number;          // initial |α| = |β| = scale
  seed?: number;
}

export interface SimOptions {
  dt: number;
  steps: number;
  snapshots?: number;
  rhoThreshold?: number;
}

export interface TraceSnapshot {
  tau: number;
  loss: number;
  rho: number;
  state: ModalState;
}

// ──────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────

function residueOfMode(m: Mode): number | Complex {
  if (m.kind === 'real') return m.alpha * m.beta;
  return mul(m.alpha, m.beta);
}

export function modeResidueMagnitudes(state: ModalState): number[] {
  return state.modes.map((m) => {
    const r = residueOfMode(m);
    return typeof r === 'number' ? Math.abs(r) : abs(r);
  });
}

export function modeEffectiveRank(state: ModalState, threshold = 1e-2): number {
  let n = 0;
  for (const mag of modeResidueMagnitudes(state)) if (mag > threshold) n++;
  return n;
}

/** Expand state into a (poles, residues) ModalSystem (conjugates included),
 *  for zero-finding and other observables. */
export function toModalSystem(state: ModalState): ModalSystem {
  const poles: Complex[] = [];
  const residues: Complex[] = [];
  for (const m of state.modes) {
    if (m.kind === 'real') {
      poles.push({ re: m.p, im: 0 });
      residues.push({ re: m.alpha * m.beta, im: 0 });
    } else {
      const r = mul(m.alpha, m.beta);
      poles.push(m.p);
      residues.push(r);
      poles.push(conj(m.p));
      residues.push(conj(r));
    }
  }
  return { poles, residues };
}

export function impulseResponseOfModes(modes: Mode[], T: number): number[] {
  const g = new Array<number>(T).fill(0);
  for (const m of modes) {
    if (m.kind === 'real') {
      const r = m.alpha * m.beta;
      let pt = 1;
      for (let t = 0; t < T; t++) {
        g[t] += r * pt;
        pt *= m.p;
      }
    } else {
      const r = mul(m.alpha, m.beta);
      let pt: Complex = { re: 1, im: 0 };
      for (let t = 0; t < T; t++) {
        const rp = mul(r, pt);
        g[t] += 2 * rp.re;
        pt = mul(pt, m.p);
      }
    }
  }
  return g;
}

export function impulseResponse(state: ModalState, T: number): number[] {
  return impulseResponseOfModes(state.modes, T);
}

export function lossAgainst(state: ModalState, target: ModalTarget): number {
  const g = impulseResponseOfModes(state.modes, target.T);
  let s = 0;
  for (let t = 0; t < target.T; t++) {
    const e = g[t] - target.gStar[t];
    s += e * e;
  }
  return 0.5 * s;
}

// ──────────────────────────────────────────────────────────────────────
// Default target
// ──────────────────────────────────────────────────────────────────────

/**
 * Default target: four near-orthogonal real poles spread across the disk
 * with geometric residue magnitudes (effective spectral energy of each mode
 * grows as a geometric series, 4 : 1 : 1/4 : 1/16). Hand-tuned so the
 * staircase has four cleanly-separated plateaus on the loss curve.
 *
 * Using real (rather than complex-pair) poles for the default makes the
 * basis modes  ϕ_k(t) = p_k^t  near-orthogonal in ℓ²([0,T)) as long as the
 * radii are well separated — which is exactly what makes the saddle-to-
 * saddle picture clean.
 */
export function defaultTarget(T = 160): ModalTarget {
  const poles = [0.92, 0.78, 0.55, 0.20];
  // Geometric residue spectrum.  Plateau heights ≈ (Δr_k)² × ‖ϕ_k‖²,
  // and ‖ϕ_k‖² = 1/(1−p_k²): 6.5, 2.5, 1.4, 1.04 — so to *flatten* plateau
  // ratios we choose r_k² × ‖ϕ_k‖² to scale as 4 : 1 : 1/4 : 1/16.  Solving
  // gives the magnitudes below (within rounding).
  const rmag = [1.6, 1.0, 0.55, 0.28];
  const modes: Mode[] = poles.map((p, k) => ({
    kind: 'real' as const,
    p,
    // Target factorisation: split r = α·β symmetrically; α = β = √r (with sign).
    alpha: Math.sqrt(rmag[k]),
    beta: Math.sqrt(rmag[k]),
  }));
  const gStar = impulseResponseOfModes(modes, T);
  return { modes, gStar, T };
}

// ──────────────────────────────────────────────────────────────────────
// Initialisation
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

/** Small random (α, β) at the target poles.  Initial residues are O(scale²). */
export function init(target: ModalTarget, opts: InitOptions = {}): ModalState {
  const s0 = opts.scale ?? 1e-3;
  const rand = mulberry32(opts.seed ?? 0xC0FFEE);
  const gauss = (): number => {
    // Box–Muller; fine for non-crypto deterministic init.
    const u1 = Math.max(1e-12, rand());
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const modes: Mode[] = target.modes.map((m) => {
    if (m.kind === 'real') {
      return { kind: 'real', p: m.p, alpha: s0 * gauss(), beta: s0 * gauss() };
    }
    return {
      kind: 'pair',
      p: { ...m.p },
      alpha: { re: s0 * gauss(), im: s0 * gauss() },
      beta: { re: s0 * gauss(), im: s0 * gauss() },
    };
  });
  return { modes };
}

// ──────────────────────────────────────────────────────────────────────
// Gradient
// ──────────────────────────────────────────────────────────────────────

/**
 * Gradient of L = 1/2 Σ_t (g_t − g_t*)² w.r.t. the real parameters of every
 * mode, packed in the order used by step().
 *
 * Real mode (kind='real'):  f_t = α β p^t,  ∂/∂α = β p^t,  ∂/∂β = α p^t.
 * Complex pair: r = αβ (complex), f_t = 2 Re(α β p^t).  With p^t = u_t + i v_t:
 *   f_t = 2 [ (α_R β_R − α_I β_I) u_t − (α_R β_I + α_I β_R) v_t ]
 * which gives:
 *   ∂f_t/∂α_R =  2 ( β_R u_t − β_I v_t) =  2 Re(β p^t)
 *   ∂f_t/∂α_I =  2 (−β_I u_t − β_R v_t) = −2 Im(β p^t)
 *   ∂f_t/∂β_R =  2 Re(α p^t)
 *   ∂f_t/∂β_I = −2 Im(α p^t)
 * (Poles are held fixed in this Phase-A widget; no ∂/∂p terms.)
 */
export function gradient(
  state: ModalState,
  target: ModalTarget,
): { loss: number; grads: number[][] } {
  const T = target.T;
  const g = impulseResponseOfModes(state.modes, T);
  const e = new Array<number>(T);
  let loss = 0;
  for (let t = 0; t < T; t++) {
    e[t] = g[t] - target.gStar[t];
    loss += e[t] * e[t];
  }
  loss *= 0.5;

  const grads: number[][] = [];
  for (const m of state.modes) {
    if (m.kind === 'real') {
      let dA = 0;
      let dB = 0;
      let pt = 1;
      for (let t = 0; t < T; t++) {
        dA += e[t] * m.beta * pt;
        dB += e[t] * m.alpha * pt;
        pt *= m.p;
      }
      grads.push([dA, dB]);
    } else {
      let dAR = 0;
      let dAI = 0;
      let dBR = 0;
      let dBI = 0;
      let pt: Complex = { re: 1, im: 0 };
      for (let t = 0; t < T; t++) {
        const bp = mul(m.beta, pt);
        const ap = mul(m.alpha, pt);
        dAR += e[t] * (2 * bp.re);
        dAI += e[t] * (-2 * bp.im);
        dBR += e[t] * (2 * ap.re);
        dBI += e[t] * (-2 * ap.im);
        pt = mul(pt, m.p);
      }
      grads.push([dAR, dAI, dBR, dBI]);
    }
  }
  return { loss, grads };
}

// ──────────────────────────────────────────────────────────────────────
// Step
// ──────────────────────────────────────────────────────────────────────

export function step(
  state: ModalState,
  target: ModalTarget,
  dt: number,
): { state: ModalState; loss: number } {
  const { loss, grads } = gradient(state, target);
  const newModes: Mode[] = state.modes.map((m, k) => {
    const gk = grads[k];
    if (m.kind === 'real') {
      return { kind: 'real', p: m.p, alpha: m.alpha - dt * gk[0], beta: m.beta - dt * gk[1] };
    }
    return {
      kind: 'pair',
      p: { ...m.p },
      alpha: { re: m.alpha.re - dt * gk[0], im: m.alpha.im - dt * gk[1] },
      beta: { re: m.beta.re - dt * gk[2], im: m.beta.im - dt * gk[3] },
    };
  });
  return { state: { modes: newModes }, loss };
}

// ──────────────────────────────────────────────────────────────────────
// Trajectory
// ──────────────────────────────────────────────────────────────────────

export function simulateTrajectory(
  state0: ModalState,
  target: ModalTarget,
  opts: SimOptions,
): TraceSnapshot[] {
  const N = opts.snapshots ?? 240;
  const total = opts.steps;
  const threshold = opts.rhoThreshold ?? 1e-2;

  // Log-spaced snapshots so the early dynamics (where most of the action
  // lives) get fine resolution and the long tail compresses.
  const snapAt = new Set<number>();
  snapAt.add(0);
  for (let i = 0; i < N; i++) {
    const frac = i / (N - 1);
    const idx = Math.max(1, Math.round(Math.exp(frac * Math.log(total))));
    snapAt.add(Math.min(total, idx));
  }

  const out: TraceSnapshot[] = [];
  let s = state0;
  let lastLoss = lossAgainst(s, target);
  out.push({
    tau: 0,
    loss: Math.max(lastLoss, 1e-30),
    rho: modeEffectiveRank(s, threshold),
    state: cloneState(s),
  });
  for (let n = 1; n <= total; n++) {
    const r = step(s, target, opts.dt);
    s = r.state;
    lastLoss = r.loss;
    if (snapAt.has(n)) {
      out.push({
        tau: n,
        loss: Math.max(lastLoss, 1e-30),
        rho: modeEffectiveRank(s, threshold),
        state: cloneState(s),
      });
    }
  }
  return out;
}

export function cloneState(s: ModalState): ModalState {
  return {
    modes: s.modes.map((m) =>
      m.kind === 'real'
        ? { kind: 'real', p: m.p, alpha: m.alpha, beta: m.beta }
        : {
            kind: 'pair',
            p: { ...m.p },
            alpha: { ...m.alpha },
            beta: { ...m.beta },
          },
    ),
  };
}
