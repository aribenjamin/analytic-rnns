import { describe, it, expect } from 'vitest';
import { c, abs, sub } from './complex';
import {
  type ModalSystem,
  evalH,
  numeratorPoly,
  zeros,
  impulseResponse,
  frequencyResponse,
  residuesFromZeros,
  simulate,
  poleZeroSeparation,
} from './transferFn';

describe('transfer function — single real pole', () => {
  // H(z) = r / (z - p), with p = 0.5 and r = 1.
  const sys: ModalSystem = { poles: [c(0.5)], residues: [c(1)] };

  it('evaluates to known value at z=1', () => {
    // H(1) = 1 / (1 - 0.5) = 2
    const v = evalH(sys, c(1));
    expect(v.re).toBeCloseTo(2, 12);
    expect(v.im).toBeCloseTo(0, 12);
  });

  it('impulse response is geometric series', () => {
    const g = impulseResponse(sys, 5);
    // g_s = r * p^s
    expect(g).toEqual([1, 0.5, 0.25, 0.125, 0.0625]);
  });

  it('numerator polynomial has degree 0 (no zeros)', () => {
    const q = numeratorPoly(sys);
    expect(q.length).toBe(1);
    expect(q[0].re).toBeCloseTo(1, 12);
    expect(zeros(sys).length).toBe(0);
  });
});

describe('transfer function — two real poles, residue cancellation creates a zero', () => {
  // H(z) = 1/(z - 0.5) - 1/(z - 0.2)
  //      = ((z - 0.2) - (z - 0.5)) / ((z-0.5)(z-0.2))
  //      = 0.3 / ((z-0.5)(z-0.2))
  // numerator is constant 0.3 → no finite zeros, but a zero "at infinity" (degree drops by 1).
  const sys: ModalSystem = { poles: [c(0.5), c(0.2)], residues: [c(1), c(-1)] };

  it('numerator degree drops', () => {
    const q = numeratorPoly(sys);
    // q(z) = r_1 (z - p_2) + r_2 (z - p_1) = (z - 0.2) - (z - 0.5) = 0.3
    expect(q.length).toBeGreaterThanOrEqual(1);
    expect(q[0].re).toBeCloseTo(0.3, 12);
    if (q.length > 1) {
      // leading coefficient should vanish
      expect(Math.abs(q[1].re)).toBeLessThan(1e-12);
    }
  });

  it('zeros() reports no finite zeros', () => {
    expect(zeros(sys).length).toBe(0);
  });
});

describe('transfer function — pole-zero cancellation', () => {
  // Construct a system where one residue is zero: that pole should be invisible
  // in the input-output behavior, even though it's still "in" the system.
  const sys: ModalSystem = { poles: [c(0.8), c(0.3)], residues: [c(1), c(0)] };

  it('H at z=1 only sees the first pole', () => {
    // Only the first term contributes: 1 / (1 - 0.8) = 5
    const v = evalH(sys, c(1));
    expect(v.re).toBeCloseTo(5, 12);
  });

  it('impulse response is purely the first pole', () => {
    const g = impulseResponse(sys, 4);
    expect(g[0]).toBeCloseTo(1, 12);
    expect(g[1]).toBeCloseTo(0.8, 12);
    expect(g[2]).toBeCloseTo(0.64, 12);
  });
});

describe('transfer function — complex conjugate pair', () => {
  // H(z) = 1/(z - p) + 1/(z - conj(p)) with p = 0.8 e^{i pi/4}
  // This gives a real impulse response with a damped oscillation at frequency pi/4.
  const p = { re: 0.8 * Math.cos(Math.PI / 4), im: 0.8 * Math.sin(Math.PI / 4) };
  const sys: ModalSystem = {
    poles: [p, { re: p.re, im: -p.im }],
    residues: [c(1), c(1)],
  };

  it('impulse response is real', () => {
    const g = impulseResponse(sys, 10);
    for (const v of g) expect(typeof v).toBe('number');
  });

  it('frequency response has a peak near angle pi/4', () => {
    const { theta, H } = frequencyResponse(sys, 256);
    const mag = H.map((v) => Math.hypot(v.re, v.im));
    let argmax = 0;
    for (let i = 1; i < mag.length / 2; i++) {
      if (mag[i] > mag[argmax]) argmax = i;
    }
    expect(theta[argmax]).toBeCloseTo(Math.PI / 4, 1); // within ~0.05 rad
  });

  it('simulate matches impulse response under impulse input', () => {
    const T = 8;
    const x = new Array<number>(T).fill(0);
    x[0] = 1;
    const y = simulate(sys, x);
    const g = impulseResponse(sys, T);
    // y_t = sum_{s=0..t-1} g_s * x_{t-s} — for impulse at t=0, y_t = g_{t-1} (note offset).
    // Actually with phi_k(t) summing s=0..t-1 and starting at h_0 = 0,
    // y_1 = sum_k r_k * p_k^0 * x_1 = ... no wait, x[0]=1 and the convolution is y_t = sum_s g_s * x_{t-s}.
    // For x[0]=1 and t-s=0 → s=t, y_t = g_t (using s starting at 0 for the *current* mode response,
    // simulate updates phi *then* reads, so y_0 corresponds to g_0).
    for (let t = 0; t < T; t++) {
      expect(y[t]).toBeCloseTo(g[t], 10);
    }
  });
});

describe('residuesFromZeros', () => {
  it('no zeros → residue is 1 / (product of pole-pole differences)', () => {
    // Single pole, monic numerator Q(z) = 1. Then r = 1 / 1 = 1.
    const r = residuesFromZeros([c(0.5)], []);
    expect(r).toHaveLength(1);
    expect(r[0].re).toBeCloseTo(1, 12);
    expect(r[0].im).toBeCloseTo(0, 12);
  });

  it('zero on top of a pole zeroes that residue exactly', () => {
    const poles = [c(0.5), c(0.2)];
    const r = residuesFromZeros(poles, [c(0.5)]);
    // Q(0.5) = (0.5 - 0.5) = 0 → residue at p=0.5 is 0.
    expect(abs(r[0])).toBeLessThan(1e-12);
    // Q(0.2) = (0.2 - 0.5) = -0.3; denom = (0.2 - 0.5) = -0.3; r[1] = 1.
    expect(r[1].re).toBeCloseTo(1, 12);
  });

  it('matches numeratorPoly: H from (poles, residues) equals Q(z)/P(z) sampled', () => {
    // Build a system from (poles, zeros), derive residues, then verify that
    // evalH(sys, z) equals the rational Q(z)/P(z) on a few test points.
    const poles = [c(0.6), c(-0.3)];
    const zs = [c(0.1)];
    const residues = residuesFromZeros(poles, zs);
    const sys: ModalSystem = { poles, residues };

    for (const zTest of [c(1), c(0.8), { re: 0.5, im: 0.5 }, { re: -0.2, im: 0.4 }]) {
      // Q(z) = (z - 0.1)
      const Q_re = zTest.re - 0.1;
      const Q_im = zTest.im;
      // P(z) = (z - 0.6)(z + 0.3) = z² - 0.3 z - 0.18; z² = (re² - im²) + 2·re·im·i
      const z2_re = zTest.re * zTest.re - zTest.im * zTest.im;
      const z2_im = 2 * zTest.re * zTest.im;
      const P_re = z2_re - 0.3 * zTest.re - 0.18;
      const P_im = z2_im - 0.3 * zTest.im;
      const denom = P_re * P_re + P_im * P_im;
      const expected_re = (Q_re * P_re + Q_im * P_im) / denom;
      const expected_im = (Q_im * P_re - Q_re * P_im) / denom;

      const got = evalH(sys, zTest);
      expect(got.re).toBeCloseTo(expected_re, 10);
      expect(got.im).toBeCloseTo(expected_im, 10);
    }
  });

  it('complex pole pair with zero at the pole silences the mode', () => {
    // Pole pair at p = 0.9 e^{i pi/3} and its conjugate; zero at p exactly.
    // Then residue at p is exactly 0 (and at p̄ too, since q̄ sits on p̄).
    const p = { re: 0.9 * Math.cos(Math.PI / 3), im: 0.9 * Math.sin(Math.PI / 3) };
    const pConj = { re: p.re, im: -p.im };
    const r = residuesFromZeros([p, pConj], [p, pConj]);
    expect(abs(r[0])).toBeLessThan(1e-12);
    expect(abs(r[1])).toBeLessThan(1e-12);
  });

  it('linear-in-separation: |r| ≈ s for small radial separation', () => {
    // Pole at p = 0.95 e^{i π/4}, zero at q = p + s · (p/|p|).
    // For small s, |r_p| ≈ s (with a slowly-growing multiplier).
    const theta = Math.PI / 4;
    const p = { re: 0.95 * Math.cos(theta), im: 0.95 * Math.sin(theta) };
    const pConj = { re: p.re, im: -p.im };
    const dir = { re: Math.cos(theta), im: Math.sin(theta) };
    const s = 0.05;
    const q = { re: p.re + s * dir.re, im: p.im + s * dir.im };
    const qConj = { re: q.re, im: -q.im };
    const r = residuesFromZeros([p, pConj], [q, qConj]);
    // Within ~10% of s at this small separation.
    expect(abs(r[0])).toBeGreaterThan(0.9 * s);
    expect(abs(r[0])).toBeLessThan(1.1 * s);
  });
});

describe('pole-zero separation', () => {
  it('returns 0 when a zero coincides with a pole', () => {
    // Two poles, two real residues chosen so that the system has a zero between them.
    // (e.g., 1/(z-0.5) - alpha/(z+0.5) — for the right alpha, the numerator has a real root.)
    // For a simple cancellation test: set a residue to zero. Then numerator polynomial
    // factor (z - other_pole) contains the "other" pole; the zero IS the other pole.
    const sys: ModalSystem = { poles: [c(0.5), c(0.2)], residues: [c(1), c(0)] };
    const seps = poleZeroSeparation(sys);
    // The numerator of this system: r_1 (z - 0.2) + 0 = z - 0.2.
    // Single zero at z = 0.2 → coincides with second pole.
    expect(seps[1]).toBeLessThan(1e-9);
    expect(seps[0]).toBeGreaterThan(0.1);
  });
});
