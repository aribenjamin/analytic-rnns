import { describe, it, expect } from 'vitest';
import { makeRNN, simulate, realModalRNN } from './rnn';
import {
  initWBC,
  gradientWBC,
  stepWBC,
  randomTarget,
  simulateTrajectoryWBC,
  totalDimOfModes,
  whiteNoiseInput,
  pinkNoiseInput,
  convolveCausal,
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
    const grads = gradientWBC(teacher, impulseInput(T), gStar);
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
    const T = target.gStar.length;
    const input = impulseInput(T);
    const grads = gradientWBC(rnn, input, target.gStar);

    const eps = 1e-6;
    const checkParam = (
      arr: Float64Array,
      anaGrad: Float64Array,
      label: string,
    ): void => {
      const idxs = [0, 1, arr.length - 1];
      for (const k of idxs) {
        const saved = arr[k];
        arr[k] = saved + eps;
        const lp = lossOf(rnn, input, target.gStar);
        arr[k] = saved - eps;
        const lm = lossOf(rnn, input, target.gStar);
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

function lossOf(
  rnn: ReturnType<typeof initWBC>,
  input: readonly number[],
  yStar: readonly number[],
): number {
  const T = yStar.length;
  const y = simulate(rnn, input);
  let s = 0;
  for (let t = 0; t < T; t++) {
    const e = y[t] - yStar[t];
    s += e * e;
  }
  return 0.5 * s;
}

describe('gradientWBC — finite-difference check under non-impulse input', () => {
  it('analytic gradient matches central differences for white-noise input', () => {
    const target = randomTarget({ totalDim: 3, T: 40, seed: 17 });
    const n = totalDimOfModes(target.modes);
    const rnn = initWBC(n, 3e-2, 9);
    const T = target.gStar.length;
    const u = whiteNoiseInput(T, 42);
    const yStar = convolveCausal(target.gStar, u);
    const grads = gradientWBC(rnn, u, yStar);

    const eps = 1e-6;
    const checkParam = (
      arr: Float64Array,
      anaGrad: Float64Array,
      label: string,
    ): void => {
      const idxs = [0, 1, arr.length - 1];
      for (const k of idxs) {
        const saved = arr[k];
        arr[k] = saved + eps;
        const lp = lossOf(rnn, u, yStar);
        arr[k] = saved - eps;
        const lm = lossOf(rnn, u, yStar);
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

describe('convolveCausal', () => {
  it('matches direct simulation of an LTI student on the same input', () => {
    const target = randomTarget({ totalDim: 3, T: 32, seed: 5 });
    const u = whiteNoiseInput(32, 71);
    const yConv = convolveCausal(target.gStar, u);
    // Compare against the impulseResponseOfModes-based simulation:
    // y[t] = Σ_{k=0..t} g[t-k] u[k] for an LTI system with impulse response g.
    let maxErr = 0;
    for (let t = 0; t < 32; t++) {
      let s = 0;
      for (let k = 0; k <= t; k++) s += target.gStar[t - k] * u[k];
      maxErr = Math.max(maxErr, Math.abs(yConv[t] - s));
    }
    expect(maxErr).toBeLessThan(1e-12);
  });
});

describe('noise generators', () => {
  it('whiteNoiseInput has unit total energy (Σ x² = 1)', () => {
    const x = whiteNoiseInput(128, 3);
    const e = x.reduce((a, v) => a + v * v, 0);
    expect(e).toBeCloseTo(1, 10);
  });

  it('pinkNoiseInput is real, finite, and has unit total energy', () => {
    const x = pinkNoiseInput(128, 5);
    for (const v of x) expect(Number.isFinite(v)).toBe(true);
    const e = x.reduce((a, v) => a + v * v, 0);
    expect(e).toBeCloseTo(1, 10);
  });

  it('pinkNoiseInput concentrates power at low frequencies vs white', () => {
    // Crude check: low-pass-band energy / high-pass-band energy is much
    // larger for pink than for white. (Computed via half-spectrum DFT.)
    const T = 128;
    const ratio = (x: number[]): number => {
      let loE = 0;
      let hiE = 0;
      for (let k = 1; k < T / 2; k++) {
        let re = 0;
        let im = 0;
        for (let n = 0; n < T; n++) {
          const a = (-2 * Math.PI * k * n) / T;
          re += x[n] * Math.cos(a);
          im += x[n] * Math.sin(a);
        }
        const mag2 = re * re + im * im;
        if (k < T / 8) loE += mag2;
        else if (k > T / 4) hiE += mag2;
      }
      return loE / Math.max(hiE, 1e-12);
    };
    const rPink = ratio(pinkNoiseInput(T, 11));
    const rWhite = ratio(whiteNoiseInput(T, 11));
    expect(rPink).toBeGreaterThan(rWhite * 2);
  });
});

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
