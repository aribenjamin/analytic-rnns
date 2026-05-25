import { describe, it, expect } from 'vitest';
import { computeOptimalFits } from './computeOptimalFits';

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

function impulseResponse(poles: number[], residues: number[], T: number): number[] {
  const g = new Array<number>(T).fill(0);
  for (let t = 0; t < T; t++) {
    for (let j = 0; j < poles.length; j++) g[t] += residues[j] * Math.pow(poles[j], t);
  }
  return g;
}

describe('computeOptimalFits', () => {
  it('reproduces the §7 fixed-target {0.3, 0.6, 0.9} optimum', () => {
    const tP = [0.3, 0.6, 0.9];
    const tR = [1, 1, 1];
    const gStar = impulseResponse(tP, tR, 160);
    const fits = computeOptimalFits(tP, tR, gStar, mulberry32(17));

    // Precomputed reference values (from optimalFits.ts).
    const ref = {
      1: { poles: [0.7697095486], error: 0.3452290903 },
      2: { poles: [0.4383445983, 0.8938243322], error: 0.0008768988 },
      3: { poles: [0.3, 0.6, 0.9], error: 0 },
    } as const;

    for (const fit of fits) {
      const r = ref[fit.k as 1 | 2 | 3];
      expect(fit.poles.length).toBe(fit.k);
      const ps = fit.poles.map((p) => p.re).sort((a, b) => a - b);
      const refPs = [...r.poles].sort((a, b) => a - b);
      for (let i = 0; i < ps.length; i++) {
        expect(ps[i]).toBeCloseTo(refPs[i], 3);
      }
      expect(fit.error).toBeCloseTo(r.error, 6);
    }
  });

  it('returns L*_k that is non-increasing in k', () => {
    const tP = [-0.4, 0.2, 0.75];
    const tR = [1, 1, 1];
    const gStar = impulseResponse(tP, tR, 160);
    const fits = computeOptimalFits(tP, tR, gStar, mulberry32(3));
    expect(fits[0].error).toBeGreaterThanOrEqual(fits[1].error - 1e-12);
    expect(fits[1].error).toBeGreaterThanOrEqual(fits[2].error - 1e-12);
    // k = number of target poles → exact match → near zero loss.
    expect(fits[2].error).toBeLessThan(1e-10);
  });

  it('matches arbitrary 3-real-pole target at k=3', () => {
    const tP = [0.1, 0.55, 0.82];
    const tR = [1, 1, 1];
    const gStar = impulseResponse(tP, tR, 160);
    const fits = computeOptimalFits(tP, tR, gStar, mulberry32(1));
    const k3 = fits.find((f) => f.k === 3)!;
    const ps = k3.poles.map((p) => p.re).sort((a, b) => a - b);
    expect(ps[0]).toBeCloseTo(0.1, 6);
    expect(ps[1]).toBeCloseTo(0.55, 6);
    expect(ps[2]).toBeCloseTo(0.82, 6);
  });
});
