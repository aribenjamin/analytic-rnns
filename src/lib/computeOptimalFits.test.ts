import { describe, it, expect } from 'vitest';
import { computeOptimalFits } from './computeOptimalFits';
import type { Complex } from './complex';

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Build g_t = Σ r_k p_k^t given an expanded (conjugate-pairs-listed) target.
function impulseResponse(poles: Complex[], residues: Complex[], T: number): number[] {
  const g = new Array<number>(T).fill(0);
  for (let t = 0; t < T; t++) {
    let re = 0;
    let pre = poles.map(() => ({ re: 1, im: 0 }));
    void pre;
    for (let j = 0; j < poles.length; j++) {
      // r_j * p_j^t (complex)
      const p = poles[j];
      const r = residues[j];
      // Compute p^t by repeated squaring or simple loop.
      let pt = { re: 1, im: 0 };
      for (let k = 0; k < t; k++) {
        const nr = pt.re * p.re - pt.im * p.im;
        const ni = pt.re * p.im + pt.im * p.re;
        pt = { re: nr, im: ni };
      }
      re += r.re * pt.re - r.im * pt.im;
    }
    g[t] = re;
  }
  return g;
}

function realTarget(realPoles: number[]): { poles: Complex[]; residues: Complex[] } {
  return {
    poles: realPoles.map((p) => ({ re: p, im: 0 })),
    residues: realPoles.map(() => ({ re: 1, im: 0 })),
  };
}

describe('computeOptimalFits', () => {
  it('reproduces the §7 fixed-target {0.3, 0.6, 0.9} optimum', () => {
    const { poles, residues } = realTarget([0.3, 0.6, 0.9]);
    const gStar = impulseResponse(poles, residues, 160);
    const fits = computeOptimalFits(poles, residues, gStar, mulberry32(17));

    const ref = {
      1: { poles: [0.7697], error: 0.3452290903 },
      2: { poles: [0.4383, 0.8938], error: 0.0008768988 },
    } as const;

    const k1 = fits.find((f) => f.k === 1)!;
    const k2 = fits.find((f) => f.k === 2)!;
    const k3 = fits.find((f) => f.k === 3)!;

    // k=1, k=2 should converge to the real-pole optima (complex pair shape
    // is strictly worse against a real-pole target with equal residues).
    expect(k1.poles.length).toBe(1);
    expect(k1.poles[0].re).toBeCloseTo(ref[1].poles[0], 2);
    expect(Math.abs(k1.poles[0].im)).toBeLessThan(1e-6);
    expect(k1.error).toBeCloseTo(ref[1].error, 4);

    const k2Reals = k2.poles.filter((p) => Math.abs(p.im) < 1e-6).map((p) => p.re).sort((a, b) => a - b);
    expect(k2Reals.length).toBe(2);
    expect(k2Reals[0]).toBeCloseTo(ref[2].poles[0], 2);
    expect(k2Reals[1]).toBeCloseTo(ref[2].poles[1], 2);
    expect(k2.error).toBeCloseTo(ref[2].error, 4);

    expect(k3.error).toBeLessThan(1e-6);
  });

  it('non-increasing loss in k', () => {
    const { poles, residues } = realTarget([-0.4, 0.2, 0.75]);
    const gStar = impulseResponse(poles, residues, 160);
    const fits = computeOptimalFits(poles, residues, gStar, mulberry32(3));
    expect(fits[0].error).toBeGreaterThanOrEqual(fits[1].error - 1e-9);
    expect(fits[1].error).toBeGreaterThanOrEqual(fits[2].error - 1e-9);
    expect(fits[2].error).toBeLessThan(1e-8);
  });

  it('prefers a complex pair when the target is a complex pair', () => {
    // Target: pole at 0.7e^{iπ/3} with unit residue (plus conjugate).
    const r = 0.7;
    const th = Math.PI / 3;
    const p: Complex = { re: r * Math.cos(th), im: r * Math.sin(th) };
    const pBar: Complex = { re: p.re, im: -p.im };
    const poles: Complex[] = [p, pBar];
    const residues: Complex[] = [{ re: 1, im: 0 }, { re: 1, im: 0 }];
    const gStar = impulseResponse(poles, residues, 160);

    const fits = computeOptimalFits(poles, residues, gStar, mulberry32(41));
    const k2 = fits.find((f) => f.k === 2)!;
    // The k=2 fit should match the target exactly (loss ≈ 0) by picking the
    // complex pair shape rather than two real poles.
    expect(k2.error).toBeLessThan(1e-6);
    const hasComplex = k2.poles.some((q) => Math.abs(q.im) > 1e-3);
    expect(hasComplex).toBe(true);
    // The recovered pole magnitude and angle should match the target.
    const upper = k2.poles.find((q) => q.im > 1e-3)!;
    expect(Math.hypot(upper.re, upper.im)).toBeCloseTo(r, 3);
    expect(Math.atan2(upper.im, upper.re)).toBeCloseTo(th, 3);
  });
});
