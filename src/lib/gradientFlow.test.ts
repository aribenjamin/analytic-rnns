import { describe, it, expect } from 'vitest';
import {
  defaultTarget,
  init,
  gradient,
  step,
  simulateTrajectory,
  lossAgainst,
  modeEffectiveRank,
  impulseResponseOfModes,
  cloneState,
  type Mode,
  type ModalTarget,
} from './gradientFlow';

describe('gradient flow — sanity at the target', () => {
  const target = defaultTarget(96);

  it('loss is zero when state equals target', () => {
    const stateAtTarget = cloneState({ modes: target.modes });
    const L = lossAgainst(stateAtTarget, target);
    expect(L).toBeLessThan(1e-20);
  });

  it('gradient magnitude is tiny at the target', () => {
    const stateAtTarget = cloneState({ modes: target.modes });
    const { grads } = gradient(stateAtTarget, target);
    let n2 = 0;
    for (const g of grads) for (const x of g) n2 += x * x;
    expect(Math.sqrt(n2)).toBeLessThan(1e-12);
  });
});

describe('gradient flow — monotonic descent on default target', () => {
  it('loss is non-increasing across a recorded trajectory', () => {
    const target = defaultTarget(160);
    const state0 = init(target, { scale: 5e-3, seed: 2 });
    const traj = simulateTrajectory(state0, target, {
      dt: 2e-3,
      steps: 8000,
      snapshots: 80,
      rhoThreshold: 0.1,
    });
    for (let i = 1; i < traj.length; i++) {
      expect(traj[i].loss).toBeLessThanOrEqual(traj[i - 1].loss * 1.001 + 1e-12);
    }
    expect(traj[traj.length - 1].loss).toBeLessThan(traj[0].loss * 1e-3);
  });
});

describe('gradient flow — reaches full effective rank', () => {
  it('three-mode target → rho reaches 3', () => {
    const poles = [0.85, 0.55, 0.20];
    const rmag = [1.0, 0.45, 0.20];
    const modes: Mode[] = poles.map((p, k) => ({
      kind: 'real' as const,
      p,
      alpha: Math.sqrt(rmag[k]),
      beta: Math.sqrt(rmag[k]),
    }));
    const T = 160;
    const target: ModalTarget = { modes, gStar: impulseResponseOfModes(modes, T), T };

    let s = init(target, { scale: 5e-3, seed: 7 });
    const dt = 2e-3;
    for (let n = 0; n < 30000; n++) s = step(s, target, dt).state;
    expect(modeEffectiveRank(s, 0.05)).toBe(3);
  });
});
