// Runtime computation of best-fit degree-k rational approximations to a
// real impulse response. Used by §7 KPoleBestFit when the target is
// rerolled in-browser.
//
// For each k we minimise the truncated loss ½ Σ_t (g_fit_t − g*_t)² over
// pole configurations of total degree k. The configurations enumerated are
// every (n_real, n_complex_pair) combination with n_real + 2·n_complex = k
// — so e.g. k=2 tries 2 real poles vs 1 complex conjugate pair and keeps
// the better.  Given fixed pole locations the residues are recovered by
// linear least squares on the real time-domain basis.

import type { Complex } from './complex';

export interface OptimalFit {
  k: number;
  /** Expanded conjugate pairs: a complex pair contributes both p and p̄. */
  poles: Complex[];
  /** Conjugate residues in the same order as `poles`. */
  residues: Complex[];
  /** Truncated training-loss value: ½ Σ_t (g_fit_t − g*_t)². */
  error: number;
}

interface ConfigShape {
  nReal: number;
  nComplex: number;
}

function shapesForDegree(k: number): ConfigShape[] {
  const out: ConfigShape[] = [];
  for (let nc = 0; 2 * nc <= k; nc++) out.push({ nReal: k - 2 * nc, nComplex: nc });
  return out;
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

// Real time-domain basis. Columns: first nR are p_j^t for real poles, then
// 2 cols per complex pair encoding the (Re, Im) parts of the residue.
// A complex pair at p = a+bi with residue r = u+vi contributes
//   r p^t + r̄ p̄^t = 2|p|^t (u cos(θ t) − v sin(θ t))
// so basis columns are 2|p|^t cos(θ t) (paired with u) and −2|p|^t sin(θ t)
// (paired with v).
function fitAndLoss(
  realPoles: number[],
  complexPoles: Complex[],
  gStar: number[],
): { loss: number; realRes: number[]; complexRes: Complex[] } {
  const T = gStar.length;
  const nR = realPoles.length;
  const nC = complexPoles.length;
  const m = nR + 2 * nC;
  if (m === 0) {
    let s = 0;
    for (let t = 0; t < T; t++) s += gStar[t] * gStar[t];
    return { loss: 0.5 * s, realRes: [], complexRes: [] };
  }
  const A: number[][] = new Array(T);
  for (let t = 0; t < T; t++) {
    const row = new Array<number>(m);
    for (let j = 0; j < nR; j++) row[j] = Math.pow(realPoles[j], t);
    for (let j = 0; j < nC; j++) {
      const p = complexPoles[j];
      const mag = Math.hypot(p.re, p.im);
      const arg = Math.atan2(p.im, p.re);
      const magT = Math.pow(mag, t);
      row[nR + 2 * j] = 2 * magT * Math.cos(arg * t);
      row[nR + 2 * j + 1] = -2 * magT * Math.sin(arg * t);
    }
    A[t] = row;
  }
  const AtA: number[][] = [];
  for (let i = 0; i < m; i++) AtA.push(new Array<number>(m).fill(0));
  const Atg = new Array<number>(m).fill(0);
  for (let t = 0; t < T; t++) {
    const row = A[t];
    const g = gStar[t];
    for (let i = 0; i < m; i++) {
      Atg[i] += row[i] * g;
      for (let j = i; j < m; j++) AtA[i][j] += row[i] * row[j];
    }
  }
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < i; j++) AtA[i][j] = AtA[j][i];
  }
  for (let i = 0; i < m; i++) AtA[i][i] += 1e-12;
  const x = solveLinear(AtA, Atg);
  if (x.some((v) => !isFinite(v))) {
    return { loss: Infinity, realRes: [], complexRes: [] };
  }
  let loss = 0;
  for (let t = 0; t < T; t++) {
    let s = 0;
    for (let i = 0; i < m; i++) s += A[t][i] * x[i];
    const d = s - gStar[t];
    loss += d * d;
  }
  loss *= 0.5;
  const realRes: number[] = [];
  for (let j = 0; j < nR; j++) realRes.push(x[j]);
  const complexRes: Complex[] = [];
  for (let j = 0; j < nC; j++) {
    complexRes.push({ re: x[nR + 2 * j], im: x[nR + 2 * j + 1] });
  }
  return { loss, realRes, complexRes };
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

interface ShapeResult {
  loss: number;
  realPoles: number[];
  complexPoles: Complex[];
  realRes: number[];
  complexRes: Complex[];
}

function optimizeShape(
  shape: ConfigShape,
  gStar: number[],
  rng: () => number,
  nStarts = 20,
): ShapeResult {
  const { nReal, nComplex } = shape;
  const dim = nReal + 2 * nComplex;
  const PENALTY = 1e6;

  const decode = (x: number[]): { rp: number[]; cp: Complex[] } => {
    const rp = x.slice(0, nReal);
    const cp: Complex[] = [];
    for (let j = 0; j < nComplex; j++) {
      cp.push({ re: x[nReal + 2 * j], im: x[nReal + 2 * j + 1] });
    }
    return { rp, cp };
  };

  const obj = (x: number[]): number => {
    const { rp, cp } = decode(x);
    for (const p of rp) {
      if (Math.abs(p) > 0.997) return PENALTY;
    }
    for (const p of cp) {
      const mag = Math.hypot(p.re, p.im);
      if (mag > 0.997) return PENALTY;
      if (Math.abs(p.im) < 0.015) return PENALTY;
    }
    for (let i = 0; i < rp.length; i++) {
      for (let j = i + 1; j < rp.length; j++) {
        if (Math.abs(rp[i] - rp[j]) < 1e-4) return PENALTY;
      }
    }
    const { loss } = fitAndLoss(rp, cp, gStar);
    return isFinite(loss) ? loss : PENALTY;
  };

  let best: ShapeResult = {
    loss: Infinity,
    realPoles: [],
    complexPoles: [],
    realRes: [],
    complexRes: [],
  };
  if (dim === 0) {
    const { loss, realRes, complexRes } = fitAndLoss([], [], gStar);
    return { loss, realPoles: [], complexPoles: [], realRes, complexRes };
  }
  for (let s = 0; s < nStarts; s++) {
    const x0 = new Array<number>(dim);
    for (let i = 0; i < nReal; i++) x0[i] = -0.85 + 1.7 * rng();
    for (let j = 0; j < nComplex; j++) {
      const r = 0.3 + 0.55 * rng();
      const theta = 0.25 + (Math.PI - 0.5) * rng();
      x0[nReal + 2 * j] = r * Math.cos(theta);
      x0[nReal + 2 * j + 1] = r * Math.sin(theta);
    }
    const res = nelderMead(obj, x0);
    if (res.fx < best.loss) {
      const { rp, cp } = decode(res.x);
      const cpUpper = cp.map((p) => (p.im < 0 ? { re: p.re, im: -p.im } : p));
      const fit = fitAndLoss(rp, cpUpper, gStar);
      if (fit.loss < best.loss) {
        best = {
          loss: fit.loss,
          realPoles: rp.slice(),
          complexPoles: cpUpper,
          realRes: fit.realRes,
          complexRes: fit.complexRes,
        };
      }
    }
  }
  return best;
}

function shapeResultToFit(k: number, r: ShapeResult): OptimalFit {
  const poles: Complex[] = [];
  const residues: Complex[] = [];
  for (let i = 0; i < r.realPoles.length; i++) {
    poles.push({ re: r.realPoles[i], im: 0 });
    residues.push({ re: r.realRes[i], im: 0 });
  }
  for (let j = 0; j < r.complexPoles.length; j++) {
    const p = r.complexPoles[j];
    const cr = r.complexRes[j];
    poles.push(p);
    poles.push({ re: p.re, im: -p.im });
    residues.push(cr);
    residues.push({ re: cr.re, im: -cr.im });
  }
  return { k, poles, residues, error: r.loss };
}

function degreeOfTargetPoles(targetPoles: Complex[]): number {
  // Count complex conjugate pairs as 2, treat each near-real pole as 1.
  let nR = 0;
  let nCBoth = 0; // counts both halves of each pair
  for (const p of targetPoles) {
    if (Math.abs(p.im) < 1e-9) nR++;
    else nCBoth++;
  }
  return nR + nCBoth;
}

/**
 * Compute best-fit degree-k rational approximations for k = 1..maxK against
 * a real impulse response.  `targetPoles`/`targetResidues` carry the target
 * (with both halves of any complex conjugate pair listed); we use them only
 * to detect the trivial case k ≥ deg(target).  Optimisation searches over
 * every (n_real, n_complex_pair) shape with total degree k and returns the
 * lowest-loss configuration as an expanded Complex[] pole / residue list.
 */
export function computeOptimalFits(
  targetPoles: Complex[],
  targetResidues: Complex[],
  gStar: number[],
  rng: () => number,
  maxK = 3,
): OptimalFit[] {
  const targetDeg = degreeOfTargetPoles(targetPoles);
  const fits: OptimalFit[] = [];
  for (let k = 1; k <= maxK; k++) {
    if (k >= targetDeg) {
      const poles = targetPoles.slice();
      const residues = targetResidues.slice();
      while (poles.length < k) {
        poles.push({ re: 0, im: 0 });
        residues.push({ re: 0, im: 0 });
      }
      fits.push({ k, poles, residues, error: 0 });
      continue;
    }
    const shapes = shapesForDegree(k);
    let best: ShapeResult = { loss: Infinity, realPoles: [], complexPoles: [], realRes: [], complexRes: [] };
    for (const shape of shapes) {
      const res = optimizeShape(shape, gStar, rng);
      if (res.loss < best.loss) best = res;
    }
    fits.push(shapeResultToFit(k, best));
  }
  return fits;
}
