import { describe, it, expect } from 'vitest';
import { makeRNN, simulate, realModalRNN } from './rnn';
import {
  initWBC,
  gradientWBC,
  stepWBC,
  randomTarget,
  simulateTrajectoryWBC,
  totalDimOfModes,
} from './rnnTrain';
import { impulseResponseOfModes } from './gradientFlow';

function impulseInput(T: number): number[] {
  const x = new Array<number>(T).fill(0);
  x[0] = 1;
  return x;
}

describe('gradientWBC — sanity at the teacher', () => {
  it('loss ≈ 0 when (W, b, c) reproduces the target impulse response', () => {
    // Build a teacher (W,b,c) directly; use its impulse response as g*.
    const teacher = realModalRNN(
      [0.55],
      [{ mag: 0.82, arg: Math.PI / 5 }],
      [0.7, 0.3, 0.9],
      [1.0, 0.4, -0.2],
    );
    const T = 80;
    const gStar = simulate(teacher, impulseInput(T));
    const grads = gradientWBC(teacher, gStar);
    expect(grads.loss).toBeLessThan(1e-20);
    let dWmax = 0;
    for (const v of grads.dW) dWmax = Math.max(dWmax, Math.abs(v));
    let dbMax = 0;
    for (const v of grads.db) dbMax = Math.max(dbMax, Math.abs(v));
    let dcMax = 0;
    for (const v of grads.dc) dcMax = Math.max(dcMax, Math.abs(v));
    expect(dWmax).toBeLessThan(1e-10);
    expect(dbMax).toBeLessThan(1e-10);
    expect(dcMax).toBeLessThan(1e-10);
  });
});

describe('gradientWBC — finite-difference check', () => {
  it('analytic gradient matches central differences for a random student', () => {
    const target = randomTarget({ totalDim: 3, T: 40, seed: 11 });
    const n = totalDimOfModes(target.modes);
    const rnn = initWBC(n, 3e-2, 7);
    const grads = gradientWBC(rnn, target.gStar);

    const eps = 1e-6;
    const checkParam = (
      arr: Float64Array,
      anaGrad: Float64Array,
      label: string,
    ): void => {
      // Probe a handful of entries (full check is unnecessary; this is a
      // correctness spot-test, not a coverage exercise).
      const idxs = [0, 1, arr.length - 1];
      for (const k of idxs) {
        const saved = arr[k];
        arr[k] = saved + eps;
        const lp = lossOf(rnn, target.gStar);
        arr[k] = saved - eps;
        const lm = lossOf(rnn, target.gStar);
        arr[k] = saved;
        const fd = (lp - lm) / (2 * eps);
        const rel = Math.abs(anaGrad[k] - fd) / Math.max(1, Math.abs(fd));
        expect(rel, `${label}[${k}]: ana=${anaGrad[k]}, fd=${fd}`).toBeLessThan(1e-4);
      }
    };
    checkParam(rnn.W, grads.dW, 'dW');
    checkParam(rnn.b, grads.db, 'db');
    checkParam(rnn.c, grads.dc, 'dc');
  });
});

describe('simulateTrajectoryWBC — monotonic descent on a random target', () => {
  it('loss is non-increasing across a recorded trajectory and ends well below the start', () => {
    const target = randomTarget({ totalDim: 4, T: 120, seed: 3 });
    const n = totalDimOfModes(target.modes);
    const rnn0 = initWBC(n, 5e-3, 13);
    const traj = simulateTrajectoryWBC(rnn0, target, {
      dt: 2e-3,
      steps: 6000,
      snapshots: 80,
      rhoThreshold: 0.1,
    });
    // Allow tiny non-monotonicity from finite-step Euler (cap = 0.1% jitter).
    for (let i = 1; i < traj.length; i++) {
      expect(traj[i].loss).toBeLessThanOrEqual(traj[i - 1].loss * 1.001 + 1e-12);
    }
    expect(traj[traj.length - 1].loss).toBeLessThan(traj[0].loss * 0.5);
  });
});

function lossOf(rnn: ReturnType<typeof initWBC>, gStar: readonly number[]): number {
  const T = gStar.length;
  const y = simulate(rnn, impulseInput(T));
  let s = 0;
  for (let t = 0; t < T; t++) {
    const e = y[t] - gStar[t];
    s += e * e;
  }
  return 0.5 * s;
}

describe('randomTarget — well-formed output', () => {
  it('produces modes whose dimensions sum to the requested totalDim', () => {
    for (let seed = 1; seed < 12; seed++) {
      const target = randomTarget({ totalDim: 4, T: 64, seed });
      expect(totalDimOfModes(target.modes)).toBe(4);
      expect(target.gStar.length).toBe(64);
    }
  });

  it('gStar matches impulseResponseOfModes of its own modes', () => {
    const target = randomTarget({ totalDim: 3, T: 40, seed: 2 });
    const g = impulseResponseOfModes(target.modes, 40);
    for (let t = 0; t < 40; t++) {
      expect(target.gStar[t]).toBeCloseTo(g[t], 12);
    }
  });
});
