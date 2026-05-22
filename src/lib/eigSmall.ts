/*
 * Small-matrix eigendecomposition for the §7 direct (W, b, c) widget.
 *
 *   - charPoly:      Faddeev–LeVerrier, O(n⁴). Good enough for n ≤ 8.
 *   - eigenvalues:   charPoly + polyRoots (Durand–Kerner).
 *   - modalSystemFromWBC: builds (poles, residues) from a real (W, b, c) SISO
 *     system by solving the Vandermonde system V r = g, where
 *     g_t = cᵀ Wᵗ b is the impulse response and V[t][k] = p_kᵗ. These are the
 *     same residues r_k = (cᵀ v_k)(u_kᵀ b) that appear in the partial-fraction
 *     expansion of H(z) = cᵀ (zI − W)⁻¹ b for a diagonalizable W, but the
 *     Vandermonde path avoids constructing eigenvectors explicitly.
 *
 * CLAUDE.md notes that eigendecomposition was deferred past Phase A; this
 * file is the explicit Phase-B opening for §7's W,b,c training widget.
 */

import {
  type Complex,
  abs,
  div,
  mul,
  sub,
} from './complex';
import { polyRoots, organizeRoots } from './polyRoots';
import type { ModalSystem } from './transferFn';

/** Characteristic polynomial of an n×n real matrix W in ascending power order.
 *  p(z) = a_0 + a_1 z + ... + a_n z^n  with a_n = 1.
 *
 *  Faddeev–LeVerrier recursion:
 *    M_1 = W;                  c_1 = tr(M_1)
 *    M_k = W (M_{k-1} − c_{k-1} I);   c_k = tr(M_k) / k
 *  Then p(λ) = λⁿ − c_1 λⁿ⁻¹ − ... − c_n.
 */
export function charPoly(W: Float64Array, n: number): number[] {
  const M = new Float64Array(n * n);
  for (let i = 0; i < n * n; i++) M[i] = W[i];
  const cs = new Array<number>(n);
  let tr = 0;
  for (let i = 0; i < n; i++) tr += M[i * n + i];
  cs[0] = tr;
  const next = new Float64Array(n * n);
  const shifted = new Float64Array(n * n);
  for (let k = 2; k <= n; k++) {
    // shifted = M − c_{k-1} I
    for (let i = 0; i < n * n; i++) shifted[i] = M[i];
    for (let i = 0; i < n; i++) shifted[i * n + i] -= cs[k - 2];
    // next = W · shifted
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        let s = 0;
        const rowI = i * n;
        for (let l = 0; l < n; l++) s += W[rowI + l] * shifted[l * n + j];
        next[rowI + j] = s;
      }
    }
    let t = 0;
    for (let i = 0; i < n; i++) t += next[i * n + i];
    cs[k - 1] = t / k;
    for (let i = 0; i < n * n; i++) M[i] = next[i];
  }
  // Build ascending coefficients: a_n = 1, a_{n-k} = −c_k for k = 1..n.
  const coeffs = new Array<number>(n + 1).fill(0);
  coeffs[n] = 1;
  for (let k = 1; k <= n; k++) coeffs[n - k] = -cs[k - 1];
  return coeffs;
}

export function eigenvalues(W: Float64Array, n: number): Complex[] {
  const real = charPoly(W, n);
  const coeffs: Complex[] = real.map((v) => ({ re: v, im: 0 }));
  const roots = polyRoots(coeffs);
  return organizeRoots(roots);
}

/** Solve A x = b for a complex n×n system via Gauss elimination with partial
 *  pivoting. Returns null if the matrix is too close to singular for stable
 *  back-substitution (caller can fall back to zeros). */
function solveComplexLinear(
  A: Complex[][],
  b: Complex[],
  n: number,
  pivotTol = 1e-13,
): Complex[] | null {
  const M: Complex[][] = A.map((row) => row.map((v) => ({ ...v })));
  const r = b.map((v) => ({ ...v }));
  for (let k = 0; k < n; k++) {
    let maxIdx = k;
    let maxAbs = abs(M[k][k]);
    for (let i = k + 1; i < n; i++) {
      const a = abs(M[i][k]);
      if (a > maxAbs) {
        maxAbs = a;
        maxIdx = i;
      }
    }
    if (maxAbs < pivotTol) return null;
    if (maxIdx !== k) {
      const tmpR = M[k];
      M[k] = M[maxIdx];
      M[maxIdx] = tmpR;
      const tmpRhs = r[k];
      r[k] = r[maxIdx];
      r[maxIdx] = tmpRhs;
    }
    for (let i = k + 1; i < n; i++) {
      const f = div(M[i][k], M[k][k]);
      for (let j = k; j < n; j++) {
        M[i][j] = sub(M[i][j], mul(f, M[k][j]));
      }
      r[i] = sub(r[i], mul(f, r[k]));
    }
  }
  const x = new Array<Complex>(n);
  for (let i = n - 1; i >= 0; i--) {
    let acc: Complex = { ...r[i] };
    for (let j = i + 1; j < n; j++) acc = sub(acc, mul(M[i][j], x[j]));
    x[i] = div(acc, M[i][i]);
  }
  return x;
}

/** Compute the first n impulse-response samples g_t = cᵀ Wᵗ b. */
function impulseHead(W: Float64Array, b: Float64Array, c: Float64Array, n: number): number[] {
  const g = new Array<number>(n);
  const h = new Float64Array(b);
  let y0 = 0;
  for (let i = 0; i < n; i++) y0 += c[i] * h[i];
  g[0] = y0;
  const hNext = new Float64Array(n);
  for (let t = 1; t < n; t++) {
    for (let i = 0; i < n; i++) {
      let s = 0;
      const rowI = i * n;
      for (let j = 0; j < n; j++) s += W[rowI + j] * h[j];
      hNext[i] = s;
    }
    let yt = 0;
    for (let i = 0; i < n; i++) yt += c[i] * hNext[i];
    g[t] = yt;
    for (let i = 0; i < n; i++) h[i] = hNext[i];
  }
  return g;
}

/** Build the (poles, residues) ModalSystem of the SISO system (W, b, c).
 *  Length-n result (one residue per eigenvalue, conjugates included).
 *  If the eigenvalues are nearly repeated the Vandermonde solve is singular;
 *  in that case residues are returned as zeros (the visualisation degrades
 *  gracefully — the staircase loss is still computed against the real impulse
 *  response, never via this projection). */
export function modalSystemFromWBC(
  W: Float64Array,
  b: Float64Array,
  c: Float64Array,
  n: number,
): ModalSystem {
  const poles = eigenvalues(W, n);
  const g = impulseHead(W, b, c, n);
  const V: Complex[][] = new Array(n);
  for (let t = 0; t < n; t++) {
    const row: Complex[] = new Array(n);
    for (let k = 0; k < n; k++) {
      let pt: Complex = { re: 1, im: 0 };
      for (let i = 0; i < t; i++) pt = mul(pt, poles[k]);
      row[k] = pt;
    }
    V[t] = row;
  }
  const rhs: Complex[] = g.map((v) => ({ re: v, im: 0 }));
  const residues = solveComplexLinear(V, rhs, n);
  if (!residues) {
    return { poles, residues: poles.map(() => ({ re: 0, im: 0 })) };
  }
  return { poles, residues };
}
