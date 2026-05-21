/*
 * Analytic loss surface for a single mode near a cancellation saddle.
 *
 * Restricted to the real slice (α, β ∈ ℝ) of Theorem 5.1's loss expansion
 *     ℒ(α, β) = ℒ_⊥ − α·β·J + ½ (α·β)² · S,
 * which is the simplest object that exhibits a saddle at (0,0) with the
 * α = β escape and the αβ = J/S minima. The complex generalisation lives
 * in a footnote of the prose; here the reader sees the saddle directly.
 *
 * Choice of `losBaseline`: at the global minima αβ = J/S the surface value
 * is ℒ_⊥ − ½ J²/S, so the widget passes ℒ_⊥ = ½ J²/S to keep the displayed
 * loss positive (saddle at L = ½ J²/S, minima at L = 0). This makes the
 * L(τ) time series look like Saxe's "loss decays from a plateau to ~0"
 * rather than crossing through negative values.
 */

export interface SaddleParams {
  J: number;
  S: number;
  baseline?: number;
}

export interface SaddleSample {
  tau: number;
  alpha: number;
  beta: number;
  L: number;
}

export function saddleLoss(alpha: number, beta: number, p: SaddleParams): number {
  const r = alpha * beta;
  return (p.baseline ?? 0) - r * p.J + 0.5 * r * r * p.S;
}

export interface SaddleGrad {
  dAlpha: number;
  dBeta: number;
}

export function saddleGrad(
  alpha: number,
  beta: number,
  p: SaddleParams,
): SaddleGrad {
  const r = alpha * beta;
  const inner = -p.J + r * p.S;
  return { dAlpha: beta * inner, dBeta: alpha * inner };
}

/**
 * Euler integration of gradient flow dα/dτ = −∂L/∂α, dβ/dτ = −∂L/∂β.
 *
 * The fixed points are the saddle at the origin and the minima at
 * αβ = J/S (a hyperbola of minima — degeneracy of the real slice; the
 * complex theory picks a unique minimum per separation direction).
 * Trajectories starting near the origin escape along the α = β diagonal
 * and settle on one of the two real minima (±√(J/S), ±√(J/S)).
 */
export function integrateSaddle(
  alpha0: number,
  beta0: number,
  p: SaddleParams,
  dt: number,
  T: number,
): SaddleSample[] {
  const out: SaddleSample[] = new Array(T + 1);
  let a = alpha0;
  let b = beta0;
  for (let i = 0; i <= T; i++) {
    out[i] = { tau: i * dt, alpha: a, beta: b, L: saddleLoss(a, b, p) };
    const g = saddleGrad(a, b, p);
    a -= dt * g.dAlpha;
    b -= dt * g.dBeta;
  }
  return out;
}
