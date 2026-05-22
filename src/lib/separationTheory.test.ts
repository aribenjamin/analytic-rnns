import { describe, it, expect } from 'vitest';
import { c, expi, scale, abs, sub } from './complex';
import {
  predictedSeparation,
  fitSeparation,
  transientFrequency,
  transientGrowth,
} from './separationTheory';

describe('predictedSeparation — straight line for a real pole', () => {
  it('φ = 0 with a real ε₀ stays purely real', () => {
    const tau = [0, 1, 2, 3, 4, 5];
    const eps = predictedSeparation(c(0.01), 0.4, 0, tau);
    for (const e of eps) {
      expect(e.im).toBeCloseTo(0, 12);
      expect(e.re).toBeGreaterThan(0);
    }
    // Purely exponential growth along the real axis.
    expect(eps[5].re / eps[0].re).toBeCloseTo(Math.exp(0.4 * 5), 10);
  });
});

describe('predictedSeparation — closed form, eq. 989–993', () => {
  it('returns ε₀ exactly at τ = 0 for any φ', () => {
    const eps0 = c(0.3, -0.2);
    const got = predictedSeparation(eps0, 2.0, 1.3, [0]);
    expect(got[0].re).toBeCloseTo(eps0.re, 12);
    expect(got[0].im).toBeCloseTo(eps0.im, 12);
  });

  it('φ = 0, |λ| = 1, ε₀ = 1 gives ε(1) = e', () => {
    const got = predictedSeparation(c(1), 1, 0, [1]);
    expect(got[0].re).toBeCloseTo(Math.E, 12);
    expect(got[0].im).toBeCloseTo(0, 12);
  });
});

describe('fitSeparation — recovers (|λ|, φ) from a trajectory', () => {
  it('round-trips an aligned closed-form trace', () => {
    const lambdaTrue = 0.25;
    const phiTrue = 1.0;
    // ε₀ aligned with the unstable direction e^{iφ/2}: then |ε| is a pure
    // exponential and arg(ε) is constant at φ/2, so the fit is exact.
    const eps0 = scale(expi(phiTrue / 2), 0.01);
    const tau = Array.from({ length: 41 }, (_, i) => i);
    const eps = predictedSeparation(eps0, lambdaTrue, phiTrue, tau);
    const traj = tau.map((t, i) => ({ tau: t, eps: eps[i] }));

    const fit = fitSeparation(traj);
    expect(fit.lambdaMag).toBeCloseTo(lambdaTrue, 8);
    expect(fit.phi).toBeCloseTo(phiTrue, 8);
    // The anchor lies on the trajectory.
    const anchorIdx = tau.indexOf(fit.tau0);
    expect(anchorIdx).toBeGreaterThanOrEqual(0);
    expect(abs(sub(fit.eps0, eps[anchorIdx]))).toBeLessThan(1e-12);
  });
});

describe('transient predictions, Theorem 6.1', () => {
  it('ω = |λ| sin(φ/2) and σ = |λ| cos(φ/2)', () => {
    expect(transientFrequency(2, Math.PI / 2)).toBeCloseTo(2 * Math.SQRT1_2, 12);
    expect(transientGrowth(2, Math.PI / 2)).toBeCloseTo(2 * Math.SQRT1_2, 12);
    // A real pole (φ = 0) has no transient oscillation.
    expect(transientFrequency(1.7, 0)).toBeCloseTo(0, 12);
    expect(transientGrowth(1.7, 0)).toBeCloseTo(1.7, 12);
  });
});
