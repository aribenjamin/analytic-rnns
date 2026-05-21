"""Parity tests: Python NumPy mirror vs the JS reference in ``src/lib``.

Both implementations are run on the same modal-system configurations and the
outputs are compared element-wise to 1e-9. The JS side is invoked via
``npx tsx python/scripts/eval_js.mjs`` so the TypeScript source is loaded
directly (no build step needed).
"""

from __future__ import annotations

import json
import math
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
JS_SCRIPT = REPO_ROOT / "python" / "scripts" / "eval_js.mjs"

sys.path.insert(0, str(REPO_ROOT / "python"))

from meromorphic import (  # noqa: E402
    denominator_poly,
    eval_h,
    frequency_response,
    impulse_response,
    numerator_poly,
    pole_zero_separation,
    simulate,
    zeros,
)
from meromorphic.poly_roots import organize_roots, poly_roots  # noqa: E402

TOL = 1e-9


def _c(re: float, im: float = 0.0) -> dict:
    return {"re": re, "im": im}


def _systems():
    """Five modal systems exercising the corner cases the JS tests cover."""
    p_pair = 0.8 * math.cos(math.pi / 4), 0.8 * math.sin(math.pi / 4)
    return [
        # 1. Single real pole.
        {
            "name": "single_real",
            "poles": [_c(0.5)],
            "residues": [_c(1.0)],
        },
        # 2. Complex conjugate pair.
        {
            "name": "complex_pair",
            "poles": [_c(p_pair[0], p_pair[1]), _c(p_pair[0], -p_pair[1])],
            "residues": [_c(1.0), _c(1.0)],
        },
        # 3. Two poles + one zero from residue cancellation.
        {
            "name": "two_pole_one_zero",
            "poles": [_c(0.5), _c(0.2)],
            "residues": [_c(1.0), _c(-0.5)],
        },
        # 4. Three real poles, all nonzero residues.
        {
            "name": "three_pole",
            "poles": [_c(0.6), _c(-0.3), _c(0.1)],
            "residues": [_c(1.0), _c(0.7), _c(-0.4)],
        },
        # 5. All-zero residues (effective rank zero).
        {
            "name": "zero_residues",
            "poles": [_c(0.4), _c(-0.2)],
            "residues": [_c(0.0), _c(0.0)],
        },
    ]


def _grid():
    pts = []
    for theta in np.linspace(0.0, 2 * math.pi, 12, endpoint=False):
        pts.append(_c(1.1 * math.cos(theta), 1.1 * math.sin(theta)))
    pts.append(_c(0.0, 0.0))
    pts.append(_c(0.9, 0.0))
    return pts


@pytest.fixture(scope="module")
def js_results():
    grid = _grid()
    sim_input = list(np.sin(np.linspace(0, 2 * math.pi, 16)))
    systems = _systems()
    cfg = {
        "systems": [
            {
                **s,
                "grid": grid,
                "impulseT": 12,
                "simulateInput": sim_input,
                "freqN": 32,
            }
            for s in systems
        ]
    }
    env = os.environ.copy()
    proc = subprocess.run(
        ["npx", "-y", "tsx", str(JS_SCRIPT)],
        input=json.dumps(cfg),
        capture_output=True,
        text=True,
        cwd=str(REPO_ROOT),
        env=env,
        timeout=120,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"JS script failed: {proc.stderr}")
    return systems, grid, sim_input, json.loads(proc.stdout)


def _poles_residues(s):
    poles = np.array([complex(p["re"], p["im"]) for p in s["poles"]], dtype=np.complex128)
    res = np.array([complex(r["re"], r["im"]) for r in s["residues"]], dtype=np.complex128)
    return poles, res


def _to_complex_array(arr):
    return np.array([complex(v["re"], v["im"]) for v in arr], dtype=np.complex128)


@pytest.mark.parametrize("idx", range(5))
def test_parity_per_system(js_results, idx):
    systems, grid, sim_input, js = js_results
    s = systems[idx]
    poles, residues = _poles_residues(s)
    js_sys = js["systems"][idx]

    grid_z = [complex(g["re"], g["im"]) for g in grid]
    py_eval = np.array([eval_h(poles, residues, z) for z in grid_z], dtype=np.complex128)
    js_eval = _to_complex_array(js_sys["evalGrid"])
    np.testing.assert_allclose(py_eval, js_eval, atol=TOL, rtol=TOL)

    py_imp = impulse_response(poles, residues, 12)
    np.testing.assert_allclose(py_imp, np.array(js_sys["impulse"]), atol=TOL, rtol=TOL)

    py_num = numerator_poly(poles, residues)
    js_num = _to_complex_array(js_sys["numerator"])
    assert py_num.size == js_num.size
    np.testing.assert_allclose(py_num, js_num, atol=TOL, rtol=TOL)

    py_den = denominator_poly(poles)
    js_den = _to_complex_array(js_sys["denominator"])
    np.testing.assert_allclose(py_den, js_den, atol=TOL, rtol=TOL)

    # Zeros: organizeRoots sort is deterministic, so direct compare works.
    py_zeros = zeros(poles, residues)
    js_zeros = _to_complex_array(js_sys["zeros"])
    assert py_zeros.size == js_zeros.size
    if py_zeros.size > 0:
        # Sort both by (re, im) for robust comparison: organize_roots is stable
        # but JS root-finder uses Durand-Kerner with different ordering inside
        # complex pairs vs np.roots, so reorder to be safe.
        def _key(z):
            return (round(z.real, 9), round(z.imag, 9))

        py_sorted = np.array(sorted(py_zeros, key=_key))
        js_sorted = np.array(sorted(js_zeros, key=_key))
        np.testing.assert_allclose(py_sorted, js_sorted, atol=1e-8, rtol=1e-8)

    py_sep = pole_zero_separation(poles, residues)
    js_sep = np.array(js_sys["separations"])
    # JS uses Infinity for empty zero set; JSON.stringify turns that into null.
    js_sep_clean = np.array(
        [np.inf if v is None else float(v) for v in js_sys["separations"]]
    )
    np.testing.assert_allclose(py_sep, js_sep_clean, atol=TOL, rtol=TOL)

    py_theta, py_h = frequency_response(poles, residues, 32)
    np.testing.assert_allclose(py_theta, np.array(js_sys["freq"]["theta"]), atol=TOL, rtol=TOL)
    np.testing.assert_allclose(py_h, _to_complex_array(js_sys["freq"]["H"]), atol=TOL, rtol=TOL)

    py_sim = simulate(poles, residues, np.array(sim_input))
    np.testing.assert_allclose(py_sim, np.array(js_sys["sim"]), atol=TOL, rtol=TOL)


def test_poly_roots_mirror_matches_numpy():
    # Validate the explicit DK mirror against numpy.roots on a few polynomials.
    # ascending: 1 - z^2 -> roots {1, -1}
    rts = poly_roots(np.array([-1.0 + 0j, 0.0 + 0j, 1.0 + 0j]))
    rts_sorted = np.sort_complex(rts)
    np.testing.assert_allclose(rts_sorted, np.sort_complex(np.array([-1.0, 1.0])), atol=1e-9)

    # (z - 0.5)(z - 0.2)(z + 0.3) ascending coeffs
    poles_truth = np.array([0.5, 0.2, -0.3], dtype=np.complex128)
    desc = np.poly(poles_truth)
    asc = desc[::-1]
    rts = poly_roots(asc)

    def _k(z):
        return (round(z.real, 9), round(z.imag, 9))

    a = sorted(rts.tolist(), key=_k)
    b = sorted(poles_truth.tolist(), key=_k)
    np.testing.assert_allclose(a, b, atol=1e-9)


def test_organize_roots_orders_reals_first():
    rts = np.array([0.5 + 0.3j, 0.5 - 0.3j, -0.2 + 0j], dtype=np.complex128)
    out = organize_roots(rts)
    assert abs(out[0].imag) < 1e-12
    assert out[1].imag > 0
    assert out[2].imag < 0
