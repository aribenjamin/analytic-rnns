/*
 * Polynomial root-finding via the Durand–Kerner ("Weierstrass") method.
 *
 * For a polynomial of degree n with coefficients in ascending order, the
 * algorithm starts from n distinct seeds on a circle in C, then iterates
 *
 *   r_k <- r_k - p(r_k) / prod_{j != k} (r_k - r_j)
 *
 * until convergence. It converges quadratically near simple roots and is
 * accurate enough for the small polynomials (n <= 20) we deal with here.
 *
 * For monic polynomials the seeds are conventionally taken on a circle of
 * radius slightly larger than 1; we use 1 + max|c_k|/|c_n| to be safe.
 */

import { type Complex, ZERO, ONE, abs, div, sub, polyVal, scale, mul } from './complex';

export interface PolyRootsOptions {
  tol?: number;          // convergence tolerance on |dr|
  maxIter?: number;
  initialRadius?: number;
}

export function polyRoots(
  coeffs: readonly Complex[],
  { tol = 1e-12, maxIter = 200, initialRadius }: PolyRootsOptions = {},
): Complex[] {
  // Trim trailing zero coefficients.
  let n = coeffs.length - 1;
  while (n > 0 && coeffs[n].re === 0 && coeffs[n].im === 0) n--;
  if (n === 0) return [];

  // Normalize to monic: divide by leading coefficient.
  const leading = coeffs[n];
  const monic: Complex[] = new Array(n + 1);
  for (let k = 0; k <= n; k++) monic[k] = div(coeffs[k], leading);

  // Cauchy bound for the largest root: 1 + max |a_k|.
  let bound = 0;
  for (let k = 0; k < n; k++) bound = Math.max(bound, abs(monic[k]));
  const r0 = initialRadius ?? Math.max(1, 1 + bound);

  // Aberth-style seeds: spread on a circle with a slight rotation so they
  // don't coincide for real coefficients.
  const roots: Complex[] = new Array(n);
  for (let k = 0; k < n; k++) {
    const theta = (2 * Math.PI * (k + 0.25)) / n;
    roots[k] = { re: r0 * Math.cos(theta), im: r0 * Math.sin(theta) };
  }

  for (let it = 0; it < maxIter; it++) {
    let maxDelta = 0;
    for (let k = 0; k < n; k++) {
      let denom: Complex = { ...ONE };
      for (let j = 0; j < n; j++) {
        if (j === k) continue;
        const diff = sub(roots[k], roots[j]);
        denom = mul(denom, diff);
      }
      const num = polyVal(monic, roots[k]);
      const dr = div(num, denom);
      roots[k] = sub(roots[k], dr);
      const mag = abs(dr);
      if (mag > maxDelta) maxDelta = mag;
    }
    if (maxDelta < tol) break;
  }

  return roots;
}

/**
 * Pair complex roots into conjugate-pair structure. Returns roots sorted so
 * that real roots come first, then complex pairs adjacent (z, z*) with
 * Im(z) > 0 first.
 */
export function organizeRoots(roots: readonly Complex[], imagTol = 1e-8): Complex[] {
  const reals: Complex[] = [];
  const imagPos: Complex[] = [];
  const imagNeg: Complex[] = [];
  for (const r of roots) {
    if (Math.abs(r.im) < imagTol) reals.push({ re: r.re, im: 0 });
    else if (r.im > 0) imagPos.push(r);
    else imagNeg.push(r);
  }
  // Sort each group so that pairing is stable.
  reals.sort((a, b) => a.re - b.re);
  imagPos.sort((a, b) => a.re - b.re || a.im - b.im);
  imagNeg.sort((a, b) => a.re - b.re || -(a.im - b.im));

  const out: Complex[] = [...reals];
  // Pair up: prefer matching imagPos[k] with the imagNeg whose re is closest.
  for (const p of imagPos) {
    let bestIdx = -1;
    let bestDist = Infinity;
    for (let i = 0; i < imagNeg.length; i++) {
      const d = Math.hypot(p.re - imagNeg[i].re, p.im + imagNeg[i].im);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    out.push(p);
    if (bestIdx >= 0) {
      out.push(imagNeg[bestIdx]);
      imagNeg.splice(bestIdx, 1);
    }
  }
  // Any unpaired negatives — shouldn't happen for real polynomials but include for safety.
  out.push(...imagNeg);
  return out;
}
