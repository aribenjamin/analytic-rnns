// Runtime computation of Gram-loss optimal k-real-pole rational
// approximations to a real-pole target. Port of
// python/scripts/compute_optimal_fits.py, used by §7 KPoleBestFit when the
// target poles are rerolled in-browser.

import type { Complex } from './complex';

export interface OptimalFit {
  k: number;
  poles: Complex[];
  residues: Complex[];
  /** Truncated training-loss value: ½ Σ_t (g_opt_t - g*_t)². */
  error: number;
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row) => row.slice());
  const y = b.slice();
  for (let i = 0; i < n; i++) {
    let piv = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(M[k][i]) > Math.abs(M[piv][i])) piv = k;
    }
    if (piv !== i) {
      [M[i], M[piv]] = [M[piv], M[i]];
      [y[i], y[piv]] = [y[piv], y[i]];
    }
    const p = M[i][i];
    if (Math.abs(p) < 1e-14) return new Array(n).fill(NaN);
    for (let k = i + 1; k < n; k++) {
      const f = M[k][i] / p;
      for (let j = i; j < n; j++) M[k][j] -= f * M[i][j];
      y[k] -= f * y[i];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j];
    x[i] = s / M[i][i];
  }
  return x;
}

function gNormSqInfty(tPoles: number[], tRes: number[]): number {
  let s = 0;
  for (let i = 0; i < tPoles.length; i++) {
    for (let j = 0; j < tPoles.length; j++) {
      s += (tRes[i] * tRes[j]) / (1 - tPoles[i] * tPoles[j]);
    }
  }
  return s;
}

function gramLoss(
  sPoles: number[],
  tPoles: number[],
  tRes: number[],
  gNormSq: number,
): { L: number; r: number[] } {
  const k = sPoles.length;
  const G: number[][] = [];
  const d: number[] = new Array(k).fill(0);
  for (let i = 0; i < k; i++) {
    const row = new Array<number>(k);
    for (let j = 0; j < k; j++) row[j] = 1 / (1 - sPoles[i] * sPoles[j]);
    G.push(row);
    for (let m = 0; m < tPoles.length; m++) {
      d[i] += tRes[m] / (1 - tPoles[m] * sPoles[i]);
    }
  }
  const r = solveLinear(G, d);
  if (r.some((x) => !isFinite(x))) return { L: Infinity, r };
  let dr = 0;
  for (let i = 0; i < k; i++) dr += d[i] * r[i];
  return { L: 0.5 * (gNormSq - dr), r };
}

function truncatedLoss(poles: number[], residues: number[], gStar: number[]): number {
  const T = gStar.length;
  let acc = 0;
  const k = poles.length;
  for (let t = 0; t < T; t++) {
    let g = 0;
    for (let j = 0; j < k; j++) g += residues[j] * Math.pow(poles[j], t);
    const d = g - gStar[t];
    acc += d * d;
  }
  return 0.5 * acc;
}

function nelderMead(
  f: (x: number[]) => number,
  x0: number[],
  maxIter = 800,
  tolF = 1e-12,
  tolX = 1e-9,
): { x: number[]; fx: number } {
  const n = x0.length;
  const simplex: { x: number[]; f: number }[] = [];
  simplex.push({ x: x0.slice(), f: f(x0) });
  for (let i = 0; i < n; i++) {
    const xi = x0.slice();
    xi[i] += xi[i] === 0 ? 0.05 : 0.05 * (Math.abs(xi[i]) || 1);
    simplex.push({ x: xi, f: f(xi) });
  }
  for (let iter = 0; iter < maxIter; iter++) {
    simplex.sort((a, b) => a.f - b.f);
    const fRange = simplex[n].f - simplex[0].f;
    let xRange = 0;
    for (let i = 1; i <= n; i++) {
      for (let j = 0; j < n; j++) {
        xRange = Math.max(xRange, Math.abs(simplex[i].x[j] - simplex[0].x[j]));
      }
    }
    if (fRange < tolF && xRange < tolX) break;

    const c = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) c[j] += simplex[i].x[j];
    }
    for (let j = 0; j < n; j++) c[j] /= n;

    const worst = simplex[n];
    const xr = c.map((cj, j) => cj + (cj - worst.x[j]));
    const fr = f(xr);
    if (fr < simplex[0].f) {
      const xe = c.map((cj, j) => cj + 2 * (xr[j] - cj));
      const fe = f(xe);
      simplex[n] = fe < fr ? { x: xe, f: fe } : { x: xr, f: fr };
    } else if (fr < simplex[n - 1].f) {
      simplex[n] = { x: xr, f: fr };
    } else {
      const xc = c.map((cj, j) => cj + 0.5 * (worst.x[j] - cj));
      const fc = f(xc);
      if (fc < worst.f) {
        simplex[n] = { x: xc, f: fc };
      } else {
        const x0v = simplex[0].x;
        for (let i = 1; i <= n; i++) {
          const xi = simplex[i].x.map((xij, j) => x0v[j] + 0.5 * (xij - x0v[j]));
          simplex[i] = { x: xi, f: f(xi) };
        }
      }
    }
  }
  simplex.sort((a, b) => a.f - b.f);
  return { x: simplex[0].x, fx: simplex[0].f };
}

function optimizeKPoles(
  k: number,
  tPoles: number[],
  tRes: number[],
  gNormSq: number,
  rng: () => number,
  nStarts = 24,
): { L: number; poles: number[]; residues: number[] } {
  const PENALTY = 1e6;
  const obj = (p: number[]): number => {
    for (let i = 0; i < p.length; i++) {
      if (Math.abs(p[i]) > 0.997) return PENALTY;
      for (let j = i + 1; j < p.length; j++) {
        if (Math.abs(p[i] - p[j]) < 1e-5) return PENALTY;
      }
    }
    const { L } = gramLoss(p, tPoles, tRes, gNormSq);
    return isFinite(L) ? L : PENALTY;
  };

  let bestL = Infinity;
  let bestP: number[] = new Array(k).fill(0);
  for (let s = 0; s < nStarts; s++) {
    const p0 = new Array<number>(k);
    for (let i = 0; i < k; i++) p0[i] = -0.85 + 1.7 * rng();
    p0.sort((a, b) => a - b);
    const res = nelderMead(obj, p0);
    if (res.fx < bestL) {
      bestL = res.fx;
      bestP = res.x.slice();
    }
  }
  bestP.sort((a, b) => a - b);
  const { L, r } = gramLoss(bestP, tPoles, tRes, gNormSq);
  return { L, poles: bestP, residues: r };
}

/**
 * Compute Gram-loss-optimal k-real-pole rational approximations for
 * k = 1..maxK against a real-pole target. The `error` field is the truncated
 * finite-T loss ½ Σ_{t=0}^{T-1} (g_opt_t - g*_t)² evaluated against `gStar`,
 * matching the training-loss units used by the §7 widget.
 */
export function computeOptimalFits(
  targetPoles: number[],
  targetResidues: number[],
  gStar: number[],
  rng: () => number,
  maxK = 3,
): OptimalFit[] {
  const gNormSq = gNormSqInfty(targetPoles, targetResidues);
  const fits: OptimalFit[] = [];
  for (let k = 1; k <= maxK; k++) {
    let poles: number[];
    let residues: number[];
    if (k >= targetPoles.length) {
      poles = targetPoles.slice();
      residues = targetResidues.slice();
      while (poles.length < k) {
        poles.push(0);
        residues.push(0);
      }
    } else {
      const opt = optimizeKPoles(k, targetPoles, targetResidues, gNormSq, rng);
      poles = opt.poles;
      residues = opt.residues;
    }
    fits.push({
      k,
      poles: poles.map((p) => ({ re: p, im: 0 })),
      residues: residues.map((r) => ({ re: r, im: 0 })),
      error: truncatedLoss(poles, residues, gStar),
    });
  }
  return fits;
}
