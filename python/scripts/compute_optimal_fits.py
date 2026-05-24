"""
Compute Gram-loss optimal k-pole rational approximations to the §7 target.

Target: three real poles {0.3, 0.6, 0.9} with equal residues (1, 1, 1).

For each k ∈ {1, 2, 3} we find the real-pole configuration that minimises the
closed-form Gram loss

    L*(p) = ½(‖g*‖² - d^T G^{-1} d),
    G_{jl} = 1/(1 - p_j p_l),
    d_l   = Σ_j r_j* / (1 - p_j* p_l),

then emit a TypeScript constants file matching the existing optimalFits.ts
schema. The 'error' field is the truncated finite-T loss ½ Σ_t (g_opt - g*)²
at T = 160, which matches the training-loss units used by the widget.

Usage:
  python3 python/scripts/compute_optimal_fits.py > src/lib/optimalFits.ts
"""

import sys
import numpy as np
from scipy.optimize import minimize

# ── Target definition ──────────────────────────────────────────────────

TARGET_POLES = np.array([0.3, 0.6, 0.9])
TARGET_RESIDUES = np.array([1.0, 1.0, 1.0])
T_HORIZON = 160


def impulse_response(poles, residues, T):
    """g_t = Σ_k r_k p_k^t for t = 0..T-1 (returns real array)."""
    poles = np.asarray(poles, dtype=complex)
    residues = np.asarray(residues, dtype=complex)
    t = np.arange(T)
    G = residues[:, None] * (poles[:, None] ** t)
    return G.sum(axis=0).real


g_star = impulse_response(TARGET_POLES, TARGET_RESIDUES, T_HORIZON)
g_star_norm_sq_infty = float((TARGET_RESIDUES[:, None] * TARGET_RESIDUES[None, :]
                              / (1.0 - TARGET_POLES[:, None] * TARGET_POLES[None, :])).sum())
g_star_norm_sq_T = float(np.sum(g_star ** 2))


def gram_loss(p):
    """Return (L*_∞, optimal residues r) for real student poles p."""
    p = np.asarray(p, dtype=float)
    G = 1.0 / (1.0 - p[:, None] * p[None, :])
    d = (TARGET_RESIDUES[:, None] / (1.0 - TARGET_POLES[:, None] * p[None, :])).sum(axis=0)
    r = np.linalg.solve(G, d)
    return 0.5 * (g_star_norm_sq_infty - d @ r), r


def loss_only(p):
    # Guard against poles approaching ±1 (Gram becomes singular).
    if np.any(np.abs(p) >= 0.999):
        return 1e6
    # Guard against pole collisions (G singular when p_j == p_l for two j ≠ l).
    if len(p) > 1:
        dmin = np.min(np.abs(p[:, None] - p[None, :] + np.eye(len(p))))
        if dmin < 1e-6:
            return 1e6
    L, _ = gram_loss(p)
    return L


def truncated_loss(poles, residues, T=T_HORIZON):
    """½ Σ_t (g_opt_t - g_star_t)² evaluated at finite T (matches widget loss)."""
    g_opt = impulse_response(poles, residues, T)
    return 0.5 * float(np.sum((g_opt - g_star) ** 2))


def optimize_k_poles(k, n_starts=30, seed=0):
    """Global min of L*(p) over real p in (-0.99, 0.99)^k, multi-start."""
    rng = np.random.default_rng(seed)
    best = (np.inf, None, None)
    for _ in range(n_starts):
        p0 = rng.uniform(-0.85, 0.85, size=k)
        p0.sort()
        res = minimize(
            loss_only, p0, method='Nelder-Mead',
            options={'xatol': 1e-10, 'fatol': 1e-14, 'maxiter': 10000},
        )
        if res.fun < best[0]:
            L, r = gram_loss(res.x)
            best = (L, res.x.copy(), r)
    return best


# ── Optimise ──────────────────────────────────────────────────────────

fits = []
for k in (1, 2, 3):
    L_infty, poles, residues = optimize_k_poles(k, n_starts=40, seed=k * 31)
    L_finite = truncated_loss(poles, residues)
    fits.append((k, poles, residues, L_infty, L_finite))
    print(
        f"# k={k}: poles={[f'{x:.4f}' for x in poles]}, "
        f"residues={[f'{x:.4f}' for x in residues]}, "
        f"L*_inf={L_infty:.6e}, L*_T={L_finite:.6e}",
        file=sys.stderr,
    )


# ── Emit TypeScript ───────────────────────────────────────────────────

def fmt_complex(re_val, im_val=0.0):
    return f"{{ re: {re_val:.10f}, im: {im_val:.10f} }}"


print("import type { Complex } from './complex';")
print()
print("export interface OptimalFit {")
print("  k: number;")
print("  poles: Complex[];")
print("  residues: Complex[];")
print("  /** Truncated training-loss value at this fit: ½ Σ_t (g_opt_t - g*_t)². */")
print("  error: number;")
print("}")
print()

print("export const FIXED_TARGET_POLES: Complex[] = [")
for p in TARGET_POLES:
    print(f"  {fmt_complex(p)},")
print("];")
print()

print("export const FIXED_TARGET_RESIDUES: Complex[] = [")
for r in TARGET_RESIDUES:
    print(f"  {fmt_complex(r)},")
print("];")
print()

print("// Gram-loss optimal k-pole rational approximations to the target.")
print(f"// ‖g*‖²_∞ (Gram) = {g_star_norm_sq_infty:.6f}")
print(f"// ‖g*‖²_T  (sum_0^{T_HORIZON-1}) = {g_star_norm_sq_T:.6f}")
for k, poles, residues, L_inf, L_T in fits:
    p_str = [f"{x:.4f}" for x in poles]
    print(f"// k={k}: poles={p_str}, L*_∞={L_inf:.6e}, L*_T={L_T:.6e}")
print()

print("export const OPTIMAL_FITS: OptimalFit[] = [")
for k, poles, residues, _, L_finite in fits:
    print(f"  {{ k: {k}, error: {L_finite:.10f},")
    p_repr = ', '.join(fmt_complex(float(p)) for p in poles)
    r_repr = ', '.join(fmt_complex(float(r)) for r in residues)
    print(f"    poles: [{p_repr}],")
    print(f"    residues: [{r_repr}],")
    print(f"  }},")
print("];")
