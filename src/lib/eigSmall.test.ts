import { describe, it, expect } from 'vitest';
import { realModalRNN, makeRNN, setW, simulate } from './rnn';
import { charPoly, eigenvalues, modalSystemFromWBC } from './eigSmall';
import { impulseResponse } from './transferFn';

describe('charPoly + eigenvalues', () => {
  it('diagonal matrix: eigenvalues equal diagonal entries', () => {
    const n = 3;
    const W = new Float64Array(n * n);
    W[0] = 0.7;
    W[4] = -0.3;
    W[8] = 0.42;
    const eigs = eigenvalues(W, n);
    const vals = eigs.map((e) => e.re).sort((a, b) => a - b);
    expect(vals[0]).toBeCloseTo(-0.3, 8);
    expect(vals[1]).toBeCloseTo(0.42, 8);
    expect(vals[2]).toBeCloseTo(0.7, 8);
    for (const e of eigs) expect(Math.abs(e.im)).toBeLessThan(1e-8);
  });

  it('complex-pair block: eigenvalues match mag e^{±i arg}', () => {
    const rnn = realModalRNN([], [{ mag: 0.85, arg: Math.PI / 4 }], [1, 0], [1, 0]);
    const eigs = eigenvalues(rnn.W, rnn.n);
    const mags = eigs.map((e) => Math.hypot(e.re, e.im));
    expect(mags[0]).toBeCloseTo(0.85, 8);
    expect(mags[1]).toBeCloseTo(0.85, 8);
    const args = eigs.map((e) => Math.atan2(e.im, e.re)).sort((a, b) => a - b);
    expect(args[0]).toBeCloseTo(-Math.PI / 4, 8);
    expect(args[1]).toBeCloseTo(Math.PI / 4, 8);
  });

  it('mixed real + pair: charPoly produces correct ascending coefficients', () => {
    // W block-diag(0.5, 2×2 block for 0.8 e^{±iπ/3}); det = 0.5 * 0.64; trace = 0.5 + 2*0.8*cos(π/3)
    const rnn = realModalRNN([0.5], [{ mag: 0.8, arg: Math.PI / 3 }], [1, 0, 0], [1, 0, 0]);
    const p = charPoly(rnn.W, rnn.n);
    // Expected: (z - 0.5)(z^2 - 2*0.8 cos(π/3) z + 0.64)
    //         = (z - 0.5)(z^2 - 0.8 z + 0.64)
    //         = z^3 - 0.8 z^2 + 0.64 z − 0.5 z^2 + 0.4 z − 0.32
    //         = z^3 − 1.3 z^2 + 1.04 z − 0.32
    expect(p[3]).toBeCloseTo(1, 12);
    expect(p[2]).toBeCloseTo(-1.3, 8);
    expect(p[1]).toBeCloseTo(1.04, 8);
    expect(p[0]).toBeCloseTo(-0.32, 8);
  });
});

describe('modalSystemFromWBC — impulse response round-trip', () => {
  it('reproduces the impulse response of a diagonal system', () => {
    // W = diag(0.6, 0.3); b = (1, 1); c = (1, 1). g_t = 0.6^t + 0.3^t.
    const n = 2;
    const rnn = makeRNN(n);
    setW(rnn, 0, 0, 0.6);
    setW(rnn, 1, 1, 0.3);
    rnn.b.set([1, 1]);
    rnn.c.set([1, 1]);
    const sys = modalSystemFromWBC(rnn.W, rnn.b, rnn.c, n);
    const T = 20;
    const gModal = impulseResponse(sys, T);
    const gDirect = simulate(rnn, padImpulse(T));
    for (let t = 0; t < T; t++) {
      expect(gModal[t]).toBeCloseTo(gDirect[t], 9);
    }
  });

  it('reproduces the impulse response of a mixed real + complex-pair system', () => {
    const rnn = realModalRNN(
      [0.55],
      [{ mag: 0.82, arg: Math.PI / 5 }],
      [0.7, 0.3, 0.9],
      [1.0, 0.4, -0.2],
    );
    const sys = modalSystemFromWBC(rnn.W, rnn.b, rnn.c, rnn.n);
    const T = 60;
    const gModal = impulseResponse(sys, T);
    const gDirect = simulate(rnn, padImpulse(T));
    for (let t = 0; t < T; t++) {
      expect(gModal[t]).toBeCloseTo(gDirect[t], 8);
    }
  });
});

function padImpulse(T: number): number[] {
  const x = new Array<number>(T).fill(0);
  x[0] = 1;
  return x;
}
