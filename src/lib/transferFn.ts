/*
 * Transfer function utilities for SISO systems.
 *
 * A SISO transfer function with simple poles is fully specified by:
 *   - poles p_1, ..., p_n in C (closed under complex conjugation for real systems)
 *   - residues r_1, ..., r_n in C (with r_k conjugate-paired alongside p_k)
 *
 * Then H(z) = sum_k r_k / (z - p_k), and the numerator polynomial is
 *   Q(z) = sum_k r_k * prod_{j != k} (z - p_j),
 * whose roots are the zeros of the system. The full impulse response is
 *   g_s = sum_k r_k p_k^s.
 *
 * Working in the (poles, residues) modal parameterisation lets us avoid
 * eigendecomposition entirely for the static demos (sections 4-6). Section 7's
 * training loop will swap this layer for an explicit (W, b, c) gradient flow.
 */

import {
  type Complex,
  ZERO,
  ONE,
  add,
  mul,
  sub,
  div,
  scale,
  abs,
  expi,
  polyVal,
  polyMul,
  polyAdd,
  polyScale,
  fromRoots,
} from './complex';
import { polyRoots, organizeRoots } from './polyRoots';

export interface ModalSystem {
  poles: Complex[];      // length n
  residues: Complex[];   // length n
}

/** Evaluate H(z) at a single complex z. */
export function evalH(sys: ModalSystem, z: Complex): Complex {
  let acc: Complex = { ...ZERO };
  for (let k = 0; k < sys.poles.length; k++) {
    const denom = sub(z, sys.poles[k]);
    acc = add(acc, div(sys.residues[k], denom));
  }
  return acc;
}

/** Evaluate H on the unit circle at N equally-spaced angles in [0, 2pi). */
export function frequencyResponse(sys: ModalSystem, N: number): { theta: number[]; H: Complex[] } {
  const theta: number[] = new Array(N);
  const H: Complex[] = new Array(N);
  for (let i = 0; i < N; i++) {
    const th = (2 * Math.PI * i) / N;
    theta[i] = th;
    H[i] = evalH(sys, expi(th));
  }
  return { theta, H };
}

/** Build the numerator polynomial Q(z) = sum_k r_k * prod_{j != k} (z - p_j),
 *  in ascending coefficient form. Returns degree n-1 polynomial (or lower if
 *  cancellations occur). */
export function numeratorPoly(sys: ModalSystem): Complex[] {
  const n = sys.poles.length;
  if (n === 0) return [ZERO];

  let acc: Complex[] = [];
  for (let k = 0; k < n; k++) {
    // Build prod_{j != k} (z - p_j)
    const others = sys.poles.filter((_, j) => j !== k);
    const term = polyScale(fromRoots(others), sys.residues[k]);
    acc = acc.length === 0 ? term : polyAdd(acc, term);
  }
  return acc;
}

/** Denominator polynomial P(z) = prod_k (z - p_k). */
export function denominatorPoly(sys: ModalSystem): Complex[] {
  return fromRoots(sys.poles);
}

/** Zeros of H(z): roots of the numerator polynomial. */
export function zeros(sys: ModalSystem): Complex[] {
  const q = numeratorPoly(sys);
  if (q.length <= 1) return [];
  // Trim near-zero leading coefficients to avoid spurious "roots at infinity".
  let deg = q.length - 1;
  while (deg > 0 && abs(q[deg]) < 1e-12) deg--;
  if (deg === 0) return [];
  const trimmed = q.slice(0, deg + 1);
  return organizeRoots(polyRoots(trimmed));
}

/** Impulse response g_s for s = 0, ..., T-1. */
export function impulseResponse(sys: ModalSystem, T: number): number[] {
  // g_s = sum_k r_k p_k^s. The imaginary parts cancel for real systems.
  const g = new Array<number>(T).fill(0);
  for (let k = 0; k < sys.poles.length; k++) {
    let powk: Complex = { ...ONE };
    for (let s = 0; s < T; s++) {
      const term = mul(sys.residues[k], powk);
      g[s] += term.re;
      powk = mul(powk, sys.poles[k]);
    }
  }
  return g;
}

/** Effective rank: number of modes with |residue| above threshold. */
export function effectiveRank(sys: ModalSystem, threshold = 1e-6): number {
  let count = 0;
  for (const r of sys.residues) {
    if (abs(r) > threshold) count++;
  }
  return count;
}

/**
 * Pole-zero separation for the k-th pole: distance to its nearest zero in C.
 * Used for the saddle-distance / effective-residue analyses in §5–§7.
 */
export function poleZeroSeparation(sys: ModalSystem): number[] {
  const zs = zeros(sys);
  const out = new Array(sys.poles.length).fill(Infinity);
  for (let k = 0; k < sys.poles.length; k++) {
    for (const z of zs) {
      const d = abs(sub(sys.poles[k], z));
      if (d < out[k]) out[k] = d;
    }
  }
  return out;
}

/**
 * Apply an arbitrary input sequence through the system and return the output.
 * Uses modal decomposition: y_t = sum_k r_k * phi_k(t), where
 * phi_k(t) = sum_{s=0..t-1} p_k^s x_{t-s}.
 */
export function simulate(sys: ModalSystem, x: readonly number[]): number[] {
  const T = x.length;
  const n = sys.poles.length;
  const y = new Array<number>(T).fill(0);
  // Carry phi_k(t) as a running complex state for each mode.
  const phi: Complex[] = new Array(n);
  for (let k = 0; k < n; k++) phi[k] = { ...ZERO };
  for (let t = 0; t < T; t++) {
    // phi_k <- p_k * phi_k + x_t
    for (let k = 0; k < n; k++) {
      const next = add(mul(sys.poles[k], phi[k]), { re: x[t], im: 0 });
      phi[k] = next;
    }
    // y_t = sum_k r_k * phi_k  (imag parts cancel for real systems)
    let acc = 0;
    for (let k = 0; k < n; k++) {
      const term = mul(sys.residues[k], phi[k]);
      acc += term.re;
    }
    y[t] = acc;
  }
  return y;
}
