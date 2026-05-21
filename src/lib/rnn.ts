/*
 * Direct (W, b, c) parameterization of a SISO linear recurrent system:
 *
 *   h_{t+1} = W h_t + b x_t,
 *   y_t = c^T h_t.
 *
 * Most Phase A widgets operate in the modal (poles, residues) coordinates of
 * transferFn.ts. This file gives a parallel low-level path for demos where
 * we need to show that the same W with different (b, c) produces different
 * input–output behavior (§3 — "eigenvalues alone aren't enough"), and for
 * future work that wants to train in raw weight coordinates.
 */

export interface LinearRNN {
  n: number;
  W: Float64Array;   // row-major n*n
  b: Float64Array;   // length n
  c: Float64Array;   // length n
}

export function makeRNN(n: number): LinearRNN {
  return {
    n,
    W: new Float64Array(n * n),
    b: new Float64Array(n),
    c: new Float64Array(n),
  };
}

/** Element access for the row-major W: rnn.W[i*n + j] = W_{ij}. */
export function setW(rnn: LinearRNN, i: number, j: number, value: number): void {
  rnn.W[i * rnn.n + j] = value;
}
export function getW(rnn: LinearRNN, i: number, j: number): number {
  return rnn.W[i * rnn.n + j];
}

/** Run the recurrence forward from h_0 = 0 for input sequence x.
 *  Returns the output sequence y (length T = x.length). */
export function simulate(rnn: LinearRNN, x: readonly number[]): number[] {
  const { n, W, b, c } = rnn;
  const T = x.length;
  const y = new Array<number>(T).fill(0);
  let h = new Float64Array(n);
  let hNext = new Float64Array(n);
  for (let t = 0; t < T; t++) {
    // hNext = W h + b x_t
    for (let i = 0; i < n; i++) {
      let s = b[i] * x[t];
      const row = i * n;
      for (let j = 0; j < n; j++) s += W[row + j] * h[j];
      hNext[i] = s;
    }
    // y_t = c^T h_next
    let yt = 0;
    for (let i = 0; i < n; i++) yt += c[i] * hNext[i];
    y[t] = yt;
    // double-buffer: swap h and hNext
    const tmp = h;
    h = hNext;
    hNext = tmp;
  }
  return y;
}

/** Construct a (W, b, c) realisation that has the given real eigenvalues on
 *  the diagonal in real-modal form. For complex-conjugate pairs use
 *  `complexModalBlock`. This is mainly used in §3 to construct two networks
 *  that share W but differ in (b, c).
 *
 *  realEigs: real eigenvalues
 *  cpairs:   complex-conjugate-pair eigenvalues represented as { mag, arg }
 *  b, c:     the input/output vectors in the modal basis
 */
export function realModalRNN(
  realEigs: number[],
  cpairs: Array<{ mag: number; arg: number }>,
  b: readonly number[],
  c: readonly number[],
): LinearRNN {
  const n = realEigs.length + 2 * cpairs.length;
  if (b.length !== n || c.length !== n) {
    throw new Error(`realModalRNN: b and c must have length n=${n}`);
  }
  const rnn = makeRNN(n);
  rnn.b.set(b);
  rnn.c.set(c);
  let i = 0;
  for (const lam of realEigs) {
    setW(rnn, i, i, lam);
    i += 1;
  }
  for (const { mag, arg } of cpairs) {
    // Real 2x2 block representing the complex pair mag * e^{+/- i arg}:
    //   [  mag cos(arg)   -mag sin(arg) ]
    //   [  mag sin(arg)    mag cos(arg) ]
    const cosA = Math.cos(arg);
    const sinA = Math.sin(arg);
    setW(rnn, i,     i,     mag * cosA);
    setW(rnn, i,     i + 1, -mag * sinA);
    setW(rnn, i + 1, i,      mag * sinA);
    setW(rnn, i + 1, i + 1,  mag * cosA);
    i += 2;
  }
  return rnn;
}
