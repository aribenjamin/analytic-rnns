import { describe, it, expect } from 'vitest';
import { saddleLoss, saddleGrad, integrateSaddle } from './saddleLoss';

describe('saddleLoss analytic loss', () => {
  it('returns the baseline at the origin', () => {
    expect(saddleLoss(0, 0, { J: 1, S: 1, baseline: 0.5 })).toBeCloseTo(0.5, 12);
    expect(saddleLoss(0, 0, { J: 2, S: 0.3 })).toBeCloseTo(0, 12);
  });

  it('matches the closed form at sample points', () => {
    const p = { J: 1.4, S: 0.7 };
    const a = 0.6;
    const b = -0.4;
    const r = a * b;
    const expected = -r * p.J + 0.5 * r * r * p.S;
    expect(saddleLoss(a, b, p)).toBeCloseTo(expected, 12);
  });

  it('attains the predicted minimum value −J²/(2S) on the curve αβ = J/S', () => {
    const p = { J: 1.2, S: 0.5 };
    const expectedMin = -0.5 * p.J * p.J / p.S;
    // Pick any (α, β) with αβ = J/S = 2.4.
    expect(saddleLoss(2, 1.2, p)).toBeCloseTo(expectedMin, 10);
    expect(saddleLoss(-3, -0.8, p)).toBeCloseTo(expectedMin, 10);
  });
});

describe('saddleGrad analytic gradient', () => {
  it('vanishes at the saddle (origin)', () => {
    const g = saddleGrad(0, 0, { J: 2.3, S: 1.7 });
    expect(g.dAlpha).toBeCloseTo(0, 12);
    expect(g.dBeta).toBeCloseTo(0, 12);
  });

  it('vanishes on the minimum hyperbola αβ = J/S', () => {
    const p = { J: 1.2, S: 0.5 };
    // αβ = 2.4
    const g = saddleGrad(2, 1.2, p);
    expect(g.dAlpha).toBeCloseTo(0, 12);
    expect(g.dBeta).toBeCloseTo(0, 12);
  });

  it('numerically agrees with a finite-difference gradient', () => {
    const p = { J: 1.4, S: 0.7 };
    const a = 0.31;
    const b = -0.22;
    const h = 1e-5;
    const num = {
      dAlpha: (saddleLoss(a + h, b, p) - saddleLoss(a - h, b, p)) / (2 * h),
      dBeta: (saddleLoss(a, b + h, p) - saddleLoss(a, b - h, p)) / (2 * h),
    };
    const an = saddleGrad(a, b, p);
    expect(an.dAlpha).toBeCloseTo(num.dAlpha, 6);
    expect(an.dBeta).toBeCloseTo(num.dBeta, 6);
  });

  // Hessian at the origin from the cross term −α·β·J is [[0, −J], [−J, 0]];
  // the quartic ½(αβ)²·S contributes only at quartic order so the spectrum
  // at (0,0) is independent of S. Eigenvalues are ±J; the unstable
  // direction (negative eigenvalue ⇒ loss decreases ⇒ gradient flow escapes)
  // is α = β.
  it('has Hessian eigenvalues ±J at the origin (numerical, S = 0)', () => {
    const p = { J: 1.7, S: 0 };
    const h = 1e-3;
    const Haa = (saddleLoss(h, 0, p) - 2 * saddleLoss(0, 0, p) + saddleLoss(-h, 0, p)) / (h * h);
    const Hbb = (saddleLoss(0, h, p) - 2 * saddleLoss(0, 0, p) + saddleLoss(0, -h, p)) / (h * h);
    const Hab = (saddleLoss(h, h, p) - saddleLoss(h, -h, p) - saddleLoss(-h, h, p) + saddleLoss(-h, -h, p)) / (4 * h * h);
    expect(Haa).toBeCloseTo(0, 6);
    expect(Hbb).toBeCloseTo(0, 6);
    expect(Hab).toBeCloseTo(-p.J, 6);
    // Eigenvalues of [[0, −J], [−J, 0]] are ±J.
    const trace = Haa + Hbb;
    const det = Haa * Hbb - Hab * Hab;
    const disc = Math.sqrt(Math.max(0, trace * trace - 4 * det));
    const muPlus = (trace + disc) / 2;
    const muMinus = (trace - disc) / 2;
    expect(muPlus).toBeCloseTo(p.J, 5);
    expect(muMinus).toBeCloseTo(-p.J, 5);
  });

  it('has the same ±J Hessian spectrum at the origin for S > 0', () => {
    const p = { J: 1.2, S: 0.9 };
    const h = 1e-3;
    const Haa = (saddleLoss(h, 0, p) - 2 * saddleLoss(0, 0, p) + saddleLoss(-h, 0, p)) / (h * h);
    const Hbb = (saddleLoss(0, h, p) - 2 * saddleLoss(0, 0, p) + saddleLoss(0, -h, p)) / (h * h);
    const Hab = (saddleLoss(h, h, p) - saddleLoss(h, -h, p) - saddleLoss(-h, h, p) + saddleLoss(-h, -h, p)) / (4 * h * h);
    expect(Haa).toBeCloseTo(0, 6);
    expect(Hbb).toBeCloseTo(0, 6);
    expect(Hab).toBeCloseTo(-p.J, 6);
  });

  it('points the gradient toward the saddle along the stable direction α = −β', () => {
    // Along α = −β the loss is α²J + ½α⁴S, monotonically increasing in |α|.
    // The gradient flow −∇L drags (ε, −ε) → (0, 0).
    const p = { J: 1, S: 1 };
    const eps = 0.1;
    const g = saddleGrad(eps, -eps, p);
    // dα/dτ = −g.dAlpha should point toward 0 from a positive ε ⇒ g.dAlpha > 0.
    expect(g.dAlpha).toBeGreaterThan(0);
    expect(g.dBeta).toBeLessThan(0);
  });

  it('points the gradient outward along the unstable direction α = β', () => {
    // Along α = β the loss is −α²J + ½α⁴S, with a maximum at the origin
    // and minima at α² = J/S. Gradient flow escapes outward.
    const p = { J: 1, S: 1 };
    const eps = 0.1;
    const g = saddleGrad(eps, eps, p);
    // dα/dτ = −g.dAlpha > 0 ⇒ g.dAlpha < 0.
    expect(g.dAlpha).toBeLessThan(0);
    expect(g.dBeta).toBeLessThan(0);
  });
});

describe('integrateSaddle gradient flow', () => {
  it('plateaus near the saddle when started very close to it, then escapes along α = β', () => {
    const p = { J: 1.0, S: 1.0, baseline: 0.5 };
    const eps = 1e-3;
    const traj = integrateSaddle(eps, eps, p, 0.02, 800);

    // It should start near (ε, ε) and converge to a minimum on αβ = J/S = 1,
    // i.e. (1, 1) for the symmetric IC.
    const last = traj[traj.length - 1];
    expect(last.alpha).toBeCloseTo(1, 2);
    expect(last.beta).toBeCloseTo(1, 2);
    expect(Math.abs(last.L)).toBeLessThan(1e-3);

    // Plateau: early L(τ) stays within 1% of the baseline for a noticeable
    // span (it grows like ε² · e^{2Jτ}, so still tiny at τ ≈ 1).
    const baseline = p.baseline!;
    const earlyIdx = Math.floor(50 / 0.02 / 50); // τ = 1.0 → step 50
    expect(Math.abs(traj[earlyIdx].L - baseline) / baseline).toBeLessThan(0.05);

    // α = β throughout (symmetric IC, symmetric flow).
    for (const s of traj) {
      expect(s.alpha).toBeCloseTo(s.beta, 8);
    }
  });

  it('approaches the saddle from the stable direction α = −β', () => {
    const p = { J: 1.0, S: 1.0 };
    const traj = integrateSaddle(0.5, -0.5, p, 0.02, 600);
    const last = traj[traj.length - 1];
    expect(Math.abs(last.alpha)).toBeLessThan(0.05);
    expect(Math.abs(last.beta)).toBeLessThan(0.05);
  });

  it('decreases the loss monotonically (within Euler discretisation tolerance)', () => {
    const p = { J: 1.2, S: 0.8, baseline: 0.9 };
    const traj = integrateSaddle(0.05, 0.04, p, 0.01, 600);
    for (let i = 1; i < traj.length; i++) {
      expect(traj[i].L).toBeLessThanOrEqual(traj[i - 1].L + 1e-9);
    }
  });
});
