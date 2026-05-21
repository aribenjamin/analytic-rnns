import { describe, it, expect } from 'vitest';
import { sigmaAt, trajectory } from './saxe';

describe('saxe closed-form mode dynamics', () => {
  it('returns sigma0 at tau=0', () => {
    expect(sigmaAt(2.0, 0.01, 0)).toBeCloseTo(0.01, 12);
  });

  it('approaches sigma* as tau -> infinity', () => {
    expect(sigmaAt(2.0, 0.01, 100)).toBeCloseTo(2.0, 10);
  });

  it('matches hand-computed value at a known tau', () => {
    // sigma* = 1, sigma0 = 0.1, kappa = 1, tau = 0.5.
    // sigma(tau) = 1 / (1 + (10 - 1) * exp(-2 * 1 * 0.5)) = 1 / (1 + 9*exp(-1))
    const expected = 1 / (1 + 9 * Math.exp(-1));
    expect(sigmaAt(1.0, 0.1, 0.5)).toBeCloseTo(expected, 12);
  });

  it('kappa rescales time', () => {
    expect(sigmaAt(1.0, 0.1, 1.0, 2.0)).toBeCloseTo(sigmaAt(1.0, 0.1, 0.5, 1.0), 12);
  });

  it('trajectory produces monotonic ascending sigmas and decreasing loss', () => {
    const traj = trajectory([2.0, 1.2, 0.6, 0.3], 1e-3, 20, 200);
    expect(traj.tau.length).toBe(200);
    expect(traj.sigmas.length).toBe(4);
    for (const series of traj.sigmas) {
      for (let i = 1; i < series.length; i++) {
        expect(series[i]).toBeGreaterThanOrEqual(series[i - 1] - 1e-12);
      }
    }
    for (let i = 1; i < traj.loss.length; i++) {
      expect(traj.loss[i]).toBeLessThanOrEqual(traj.loss[i - 1] + 1e-12);
    }
    // Final sigmas close to targets.
    expect(traj.sigmas[0][traj.sigmas[0].length - 1]).toBeCloseTo(2.0, 4);
    expect(traj.sigmas[3][traj.sigmas[3].length - 1]).toBeCloseTo(0.3, 2);
  });
});
