/*
 * Theory overlay for §8 (Direction in ℂ: lines and spirals).
 *
 * Implements the closed-form separation flow of the paper's Theorem 6.1
 * (meromorphic_learning_dynamics_v2.tex, eq. 989–993):
 *
 *   ε(τ) = e^{iφ/2} · [ Re(e^{−iφ/2} ε₀)·e^{|λ|τ}
 *                       + i·Im(e^{−iφ/2} ε₀)·e^{−|λ|τ} ]
 *
 * the solution of the linear separation flow dε/dτ = λ·ε̄ with λ = |λ|e^{iφ}.
 * For real λ (φ = 0, real ε₀) the separation is a straight line; for complex λ
 * it rotates as it grows — the "hyperbolic spiral" — with arg(ε) sweeping
 * toward the unstable direction φ/2.
 *
 * `fitSeparation` recovers (|λ|, φ) from an actual gradient-descent ε(τ) trace,
 * so the §8 widget overlays the prediction on the network's own trajectory.
 */

import { type Complex, mul, abs, arg, expi } from './complex';

export interface SeparationFit {
  /** Escape rate |λ| — slope of log|ε| over the escape window. */
  lambdaMag: number;
  /** Separation phase φ = arg λ — twice the asymptotic direction of ε. */
  phi: number;
  /** ε at the start of the escape window — the anchor for `predictedSeparation`. */
  eps0: Complex;
  /** τ at that anchor. */
  tau0: number;
}

/**
 * Closed-form ε(τ) of the linear separation flow (Theorem 6.1).
 * `tau` values are measured from the anchor at which ε equals `eps0`.
 */
export function predictedSeparation(
  eps0: Complex,
  lambdaMag: number,
  phi: number,
  tau: readonly number[],
): Complex[] {
  const rotF = expi(phi / 2); // e^{+iφ/2}
  const rotB = expi(-phi / 2); // e^{−iφ/2}
  const w = mul(rotB, eps0); // e^{−iφ/2} ε₀  →  (η₁⁰, η₂⁰)
  return tau.map((t) => {
    const inner: Complex = {
      re: w.re * Math.exp(lambdaMag * t),
      im: w.im * Math.exp(-lambdaMag * t),
    };
    return mul(rotF, inner);
  });
}

/**
 * Fit (|λ|, φ) from an actual ε(τ) trajectory.
 *
 *   |λ| — slope of a least-squares line through (τ, log|ε|) over the escape
 *         window: after ε leaves the noise floor, before it saturates.
 *   φ   — 2·arg(ε) at the end of that window. The asymptotic separation
 *         direction is e^{iφ/2}, so arg(ε) → φ/2.
 */
export function fitSeparation(
  traj: readonly { tau: number; eps: Complex }[],
): SeparationFit {
  const pts = traj
    .map((s) => ({ tau: s.tau, mag: abs(s.eps), eps: s.eps }))
    .filter((s) => Number.isFinite(s.mag) && s.mag > 0);
  if (pts.length < 2) {
    return { lambdaMag: 0, phi: 0, eps0: { re: 0, im: 0 }, tau0: 0 };
  }

  const maxMag = Math.max(...pts.map((p) => p.mag));
  const minMag = Math.min(...pts.map((p) => p.mag));
  // Escape window: skip the noise-floor plateau and the saturation tail.
  const lo = minMag * Math.E; // ~one e-fold above the floor
  const hi = maxMag * 0.5; // below the saturation knee
  let window = pts.filter((p) => p.mag >= lo && p.mag <= hi);
  if (window.length < 2) window = pts; // fallback: use everything

  // Least-squares slope of log(mag) vs tau.
  const n = window.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (const p of window) {
    const x = p.tau;
    const y = Math.log(p.mag);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const denom = n * sxx - sx * sx;
  const slope = denom !== 0 ? (n * sxy - sx * sy) / denom : 0;
  const lambdaMag = Math.max(0, slope);

  const first = window[0];
  const last = window[window.length - 1];
  // φ = 2·arg(ε) lands in (−2π, 2π]; wrap to (−π, π], the e^{iφ/2} branch with
  // cos(φ/2) ≥ 0 that matches the paper's arg λ convention. Wrapping by 2π
  // flips e^{iφ/2}'s sign but leaves `predictedSeparation` unchanged.
  let phi = 2 * arg(last.eps);
  if (phi > Math.PI) phi -= 2 * Math.PI;
  else if (phi <= -Math.PI) phi += 2 * Math.PI;
  return { lambdaMag, phi, eps0: first.eps, tau0: first.tau };
}

/** Transient oscillation frequency, Theorem 6.1: ω = |λ|·sin(arg λ / 2). */
export function transientFrequency(lambdaMag: number, phi: number): number {
  return lambdaMag * Math.sin(phi / 2);
}

/** Transient growth rate, Theorem 6.1: σ = |λ|·cos(arg λ / 2). */
export function transientGrowth(lambdaMag: number, phi: number): number {
  return lambdaMag * Math.cos(phi / 2);
}
