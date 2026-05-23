"""
Compute H2-optimal k-pole reduced-order models of the §6 fixed target
via balanced truncation, then emit a TypeScript constants file.

Target:
  Mode 1 (real):         p = 0.85,           r = 1.2
  Mode 2 (complex pair): p = 0.65 e^{iπ/3},  r = 0.8 e^{iπ/6}
  Mode 3 (real):         p = -0.5,            r = 0.6

Usage:
  python3 python/scripts/compute_optimal_fits.py > src/lib/optimalFits.ts
"""

import numpy as np

# ── Target definition ──────────────────────────────────────────────────

P1, R1 = 0.85, 1.2
P2 = 0.65 * np.exp(1j * np.pi / 3)
R2 = 0.8 * np.exp(1j * np.pi / 6)
P3, R3 = -0.5, 0.6

# State-space realization (real block-diagonal form)
# Real mode (p, r): A=p, B=1, C=r
# Complex pair (p=a+bi, r=u+vi): A=[[a,-b],[b,a]], B=[1,0]^T, C=[2u,2v]^T
a2, b2 = P2.real, P2.imag
u2, v2 = R2.real, R2.imag

A = np.array([
    [P1,  0,    0,    0],
    [0,   a2,  -b2,   0],
    [0,   b2,   a2,   0],
    [0,   0,    0,    P3],
])
B = np.array([[1.0], [1.0], [0.0], [1.0]])
C = np.array([[R1, 2*u2, 2*v2, R3]])

T_HORIZON = 160
N_FREQ = 256

def impulse_response(A, B, C, T):
    n = A.shape[0]
    g = np.zeros(T)
    h = np.zeros(n)
    for t in range(T):
        x = 1.0 if t == 0 else 0.0
        h = A @ h + B.flatten() * x
        g[t] = C @ h
    return g

def freq_response(A, B, C, n_freq):
    thetas = np.linspace(0, np.pi, n_freq)
    H = np.zeros(n_freq, dtype=complex)
    n = A.shape[0]
    I = np.eye(n)
    for i, theta in enumerate(thetas):
        z = np.exp(1j * theta)
        H[i] = (C @ np.linalg.solve(z * I - A, B.flatten())).item()
    return thetas, H

def solve_lyapunov_discrete(A, Q, iters=800):
    """Solve X = A X A^T + Q by iteration."""
    n = A.shape[0]
    X = np.zeros((n, n))
    for _ in range(iters):
        X = A @ X @ A.T + Q
    return X

def balanced_truncation(A, B, C, k):
    """Balanced truncation of discrete-time SISO system to order k."""
    n = A.shape[0]
    P = solve_lyapunov_discrete(A, B @ B.T)
    Q = solve_lyapunov_discrete(A.T, C.T @ C)

    Lp = np.linalg.cholesky(P + 1e-14 * np.eye(n))
    M = Lp.T @ Q @ Lp
    U, sig2, _ = np.linalg.svd(M)
    sig = np.sqrt(np.maximum(sig2, 0))

    # Balancing transformation
    Sig_neg_quarter = np.diag(sig ** (-0.5))
    T = Lp @ U @ Sig_neg_quarter
    Tinv = np.diag(sig ** 0.5) @ U.T @ np.linalg.inv(Lp)

    # Truncate to first k states
    Tk = T[:, :k]
    Sk = Tinv[:k, :]
    Ak = Sk @ A @ Tk
    Bk = Sk @ B
    Ck = C @ Tk

    return Ak, Bk, Ck

def ss_to_poles_residues(Ak, Bk, Ck):
    """Convert state-space to poles + residues via eigendecomposition."""
    eigenvalues, V = np.linalg.eig(Ak)
    Vinv = np.linalg.inv(V)
    poles = eigenvalues
    residues = np.array([(Ck @ V[:, i:i+1]).item() * (Vinv[i:i+1, :] @ Bk).item()
                         for i in range(len(poles))])
    return poles, residues

def fmt_complex(z):
    return f"{{ re: {z.real:.10f}, im: {z.imag:.10f} }}"

# ── Compute ────────────────────────────────────────────────────────────

g_star = impulse_response(A, B, C, T_HORIZON)
g_star_norm_sq = np.sum(g_star ** 2)

print("import type { Complex } from './complex';")
print()
print("export interface OptimalFit {")
print("  k: number;")
print("  poles: Complex[];")
print("  residues: Complex[];")
print("  error: number;")
print("}")
print()

# Target info
print(f"export const FIXED_TARGET_POLES: Complex[] = [")
print(f"  {fmt_complex(P1+0j)},")
print(f"  {fmt_complex(P2)},")
print(f"  {fmt_complex(np.conj(P2))},")
print(f"  {fmt_complex(P3+0j)},")
print("];")
print()
print(f"export const FIXED_TARGET_RESIDUES: Complex[] = [")
print(f"  {fmt_complex(R1+0j)},")
print(f"  {fmt_complex(R2)},")
print(f"  {fmt_complex(np.conj(R2))},")
print(f"  {fmt_complex(R3+0j)},")
print("];")
print()

fits = []
for k in range(1, 5):
    if k == 4:
        # k=4 is the full target
        poles = np.array([P1, P2, np.conj(P2), P3])
        residues = np.array([R1, R2, np.conj(R2), R3], dtype=complex)
        g_approx = impulse_response(A, B, C, T_HORIZON)
    else:
        Ak, Bk, Ck = balanced_truncation(A, B, C, k)
        poles, residues = ss_to_poles_residues(Ak, Bk, Ck)
        g_approx = impulse_response(Ak, Bk, Ck, T_HORIZON)

    error = np.sum((g_star - g_approx) ** 2) / g_star_norm_sq
    fits.append((k, poles, residues, error))

    # Verify
    print(f"// k={k}: poles={[f'{p:.4f}' for p in poles]}, error={error:.6f}")

print()
print("export const OPTIMAL_FITS: OptimalFit[] = [")
for k, poles, residues, error in fits:
    print(f"  {{ k: {k}, error: {error:.10f},")
    print(f"    poles: [{', '.join(fmt_complex(p) for p in poles)}],")
    print(f"    residues: [{', '.join(fmt_complex(r) for r in residues)}],")
    print(f"  }},")
print("];")
