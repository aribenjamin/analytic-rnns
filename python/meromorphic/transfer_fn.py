"""NumPy mirror of ``src/lib/transferFn.ts``.

Modal-coordinate SISO transfer functions: ``H(z) = sum_k r_k / (z - p_k)``.
Poles/residues are complex128 arrays. Polynomial work uses :func:`numpy.poly`
and :func:`numpy.roots` for numerical stability; the explicit Durand-Kerner
mirror lives in :mod:`meromorphic.poly_roots` for parity testing.
"""

from __future__ import annotations

import math

import numpy as np

from .poly_roots import organize_roots


def _as_complex(arr) -> np.ndarray:
    return np.asarray(arr, dtype=np.complex128)


def eval_h(poles: np.ndarray, residues: np.ndarray, z: complex) -> complex:
    poles = _as_complex(poles)
    residues = _as_complex(residues)
    if poles.size == 0:
        return complex(0.0, 0.0)
    return complex(np.sum(residues / (z - poles)))


def frequency_response(
    poles: np.ndarray, residues: np.ndarray, n: int
) -> tuple[np.ndarray, np.ndarray]:
    theta = 2 * np.pi * np.arange(n) / n
    z = np.exp(1j * theta)
    poles = _as_complex(poles)
    residues = _as_complex(residues)
    # broadcast: (n, 1) - (k,) -> (n, k)
    h = np.sum(residues[None, :] / (z[:, None] - poles[None, :]), axis=1)
    return theta, h


def numerator_poly(poles: np.ndarray, residues: np.ndarray) -> np.ndarray:
    """Return Q(z) coefficients in ascending order, matching the JS layout.

    JS ``numeratorPoly`` returns ``polyAdd``-accumulated terms each of length n
    (since ``fromRoots(others)`` over n-1 roots gives degree n-1, length n).
    To match length-for-length we pad the accumulator to length n even if the
    leading coefficient happens to cancel.
    """
    poles = _as_complex(poles)
    residues = _as_complex(residues)
    n = poles.size
    if n == 0:
        return np.zeros(1, dtype=np.complex128)
    acc = np.zeros(n, dtype=np.complex128)
    for k in range(n):
        others = np.delete(poles, k)
        # np.poly returns descending coefficients of prod (z - others).
        term_desc = np.poly(others) if others.size > 0 else np.array([1.0 + 0j])
        term_asc = term_desc[::-1].astype(np.complex128) * residues[k]
        acc[: term_asc.size] += term_asc
    return acc


def denominator_poly(poles: np.ndarray) -> np.ndarray:
    poles = _as_complex(poles)
    if poles.size == 0:
        return np.array([1.0 + 0j], dtype=np.complex128)
    desc = np.poly(poles)
    return desc[::-1].astype(np.complex128)


def zeros(poles: np.ndarray, residues: np.ndarray) -> np.ndarray:
    q = numerator_poly(poles, residues)
    if q.size <= 1:
        return np.zeros(0, dtype=np.complex128)
    deg = q.size - 1
    while deg > 0 and abs(q[deg]) < 1e-12:
        deg -= 1
    if deg == 0:
        return np.zeros(0, dtype=np.complex128)
    trimmed_desc = q[: deg + 1][::-1]
    rts = np.roots(trimmed_desc)
    return organize_roots(rts)


def impulse_response(poles: np.ndarray, residues: np.ndarray, t: int) -> np.ndarray:
    poles = _as_complex(poles)
    residues = _as_complex(residues)
    g = np.zeros(t, dtype=np.float64)
    for k in range(poles.size):
        powk = complex(1.0, 0.0)
        pk = complex(poles[k])
        rk = complex(residues[k])
        for s in range(t):
            g[s] += (rk * powk).real
            powk = powk * pk
    return g


def effective_rank(residues: np.ndarray, threshold: float = 1e-6) -> int:
    residues = _as_complex(residues)
    return int(np.sum(np.abs(residues) > threshold))


def pole_zero_separation(poles: np.ndarray, residues: np.ndarray) -> np.ndarray:
    poles = _as_complex(poles)
    zs = zeros(poles, residues)
    out = np.full(poles.size, np.inf, dtype=np.float64)
    if zs.size == 0:
        return out
    for k in range(poles.size):
        d = np.abs(poles[k] - zs)
        out[k] = float(np.min(d))
    return out


def simulate(poles: np.ndarray, residues: np.ndarray, x: np.ndarray) -> np.ndarray:
    poles = _as_complex(poles)
    residues = _as_complex(residues)
    x = np.asarray(x, dtype=np.float64)
    t = x.size
    n = poles.size
    y = np.zeros(t, dtype=np.float64)
    phi = np.zeros(n, dtype=np.complex128)
    for i in range(t):
        phi = poles * phi + complex(x[i], 0.0)
        y[i] = float(np.sum(residues * phi).real)
    return y
