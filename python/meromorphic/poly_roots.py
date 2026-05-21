"""Explicit Durand-Kerner mirror of ``src/lib/polyRoots.ts``.

Used for parity verification against the JS root finder. Production code
prefers :func:`numpy.roots`; this module exists to validate that the JS
iteration converges to the same answer.
"""

from __future__ import annotations

import math

import numpy as np


def poly_roots(
    coeffs: np.ndarray,
    *,
    tol: float = 1e-12,
    max_iter: int = 200,
    initial_radius: float | None = None,
) -> np.ndarray:
    """Find roots of a polynomial in ascending-coefficient form."""
    c = np.asarray(coeffs, dtype=np.complex128).copy()
    n = c.size - 1
    while n > 0 and c[n] == 0:
        n -= 1
    if n == 0:
        return np.zeros(0, dtype=np.complex128)

    leading = c[n]
    monic = c[: n + 1] / leading

    bound = float(np.max(np.abs(monic[:n]))) if n > 0 else 0.0
    r0 = initial_radius if initial_radius is not None else max(1.0, 1.0 + bound)

    roots = np.empty(n, dtype=np.complex128)
    for k in range(n):
        theta = (2 * math.pi * (k + 0.25)) / n
        roots[k] = complex(r0 * math.cos(theta), r0 * math.sin(theta))

    for _ in range(max_iter):
        max_delta = 0.0
        for k in range(n):
            denom = complex(1.0, 0.0)
            for j in range(n):
                if j == k:
                    continue
                denom *= roots[k] - roots[j]
            num = _poly_val(monic, roots[k])
            dr = num / denom
            roots[k] = roots[k] - dr
            mag = abs(dr)
            if mag > max_delta:
                max_delta = mag
        if max_delta < tol:
            break

    return roots


def _poly_val(coeffs: np.ndarray, z: complex) -> complex:
    acc = complex(coeffs[-1])
    for k in range(coeffs.size - 2, -1, -1):
        acc = acc * z + complex(coeffs[k])
    return acc


def organize_roots(roots: np.ndarray, imag_tol: float = 1e-8) -> np.ndarray:
    """Mirror ``organizeRoots``: reals first, then conjugate pairs (Im>0 first)."""
    roots = np.asarray(roots, dtype=np.complex128)
    reals = []
    pos = []
    neg = []
    for r in roots:
        if abs(r.imag) < imag_tol:
            reals.append(complex(r.real, 0.0))
        elif r.imag > 0:
            pos.append(complex(r))
        else:
            neg.append(complex(r))

    reals.sort(key=lambda z: z.real)
    pos.sort(key=lambda z: (z.real, z.imag))
    neg.sort(key=lambda z: (z.real, -z.imag))

    out: list[complex] = list(reals)
    for p in pos:
        best_idx = -1
        best_dist = math.inf
        for i, q in enumerate(neg):
            d = math.hypot(p.real - q.real, p.imag + q.imag)
            if d < best_dist:
                best_dist = d
                best_idx = i
        out.append(p)
        if best_idx >= 0:
            out.append(neg.pop(best_idx))
    out.extend(neg)
    return np.array(out, dtype=np.complex128)
