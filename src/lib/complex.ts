/*
 * Minimal complex-number library.
 *
 * Complex values are stored as plain { re, im } records rather than a class to
 * keep the data trivially serializable across Web Worker boundaries. Operations
 * are pure functions; callers compose them. For inner loops we also expose
 * mutating helpers that take an "out" record.
 *
 * Everything here is hot-path code — keep allocations out of inner loops.
 */

export interface Complex {
  re: number;
  im: number;
}

export function c(re: number, im = 0): Complex {
  return { re, im };
}

export const ZERO: Readonly<Complex> = Object.freeze({ re: 0, im: 0 });
export const ONE: Readonly<Complex> = Object.freeze({ re: 1, im: 0 });
export const I: Readonly<Complex> = Object.freeze({ re: 0, im: 1 });

export function add(a: Complex, b: Complex): Complex {
  return { re: a.re + b.re, im: a.im + b.im };
}

export function sub(a: Complex, b: Complex): Complex {
  return { re: a.re - b.re, im: a.im - b.im };
}

export function mul(a: Complex, b: Complex): Complex {
  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  };
}

export function div(a: Complex, b: Complex): Complex {
  const denom = b.re * b.re + b.im * b.im;
  return {
    re: (a.re * b.re + a.im * b.im) / denom,
    im: (a.im * b.re - a.re * b.im) / denom,
  };
}

export function conj(a: Complex): Complex {
  return { re: a.re, im: -a.im };
}

export function neg(a: Complex): Complex {
  return { re: -a.re, im: -a.im };
}

export function scale(a: Complex, s: number): Complex {
  return { re: a.re * s, im: a.im * s };
}

export function abs(a: Complex): number {
  return Math.hypot(a.re, a.im);
}

export function abs2(a: Complex): number {
  return a.re * a.re + a.im * a.im;
}

export function arg(a: Complex): number {
  return Math.atan2(a.im, a.re);
}

/** e^{iθ}. */
export function expi(theta: number): Complex {
  return { re: Math.cos(theta), im: Math.sin(theta) };
}

/** e^a. */
export function exp(a: Complex): Complex {
  const e = Math.exp(a.re);
  return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) };
}

/** Polynomial evaluation by Horner's rule. Coeffs in ascending order:
 *  coeffs[k] = a_k, polynomial is sum_k a_k * z^k. */
export function polyVal(coeffs: readonly Complex[], z: Complex): Complex {
  // Evaluate from highest to lowest degree.
  let acc: Complex = { ...(coeffs[coeffs.length - 1] ?? ZERO) };
  for (let k = coeffs.length - 2; k >= 0; k--) {
    // acc = acc * z + coeffs[k]
    const tmp = mul(acc, z);
    acc = add(tmp, coeffs[k]);
  }
  return acc;
}

export function polyValReal(coeffs: readonly Complex[], z: Complex): Complex {
  // Same as polyVal — name kept for clarity at call sites where coeffs are
  // semantically real (im part assumed zero but stored as Complex for typing).
  return polyVal(coeffs, z);
}

/** Multiply two polynomials in ascending coefficient form. */
export function polyMul(a: readonly Complex[], b: readonly Complex[]): Complex[] {
  const out: Complex[] = new Array(a.length + b.length - 1);
  for (let k = 0; k < out.length; k++) out[k] = { re: 0, im: 0 };
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      const prod = mul(a[i], b[j]);
      out[i + j].re += prod.re;
      out[i + j].im += prod.im;
    }
  }
  return out;
}

/** Add two polynomials in ascending coefficient form. */
export function polyAdd(a: readonly Complex[], b: readonly Complex[]): Complex[] {
  const out: Complex[] = new Array(Math.max(a.length, b.length));
  for (let k = 0; k < out.length; k++) {
    const ai = k < a.length ? a[k] : ZERO;
    const bi = k < b.length ? b[k] : ZERO;
    out[k] = add(ai, bi);
  }
  return out;
}

/** Scale a polynomial by a complex scalar. */
export function polyScale(p: readonly Complex[], s: Complex): Complex[] {
  return p.map((coef) => mul(coef, s));
}

/** Build the polynomial prod_k (z - r_k), given roots r_k, in ascending form. */
export function fromRoots(roots: readonly Complex[]): Complex[] {
  let p: Complex[] = [ONE];
  for (const r of roots) {
    // multiply by (z - r): polynomial [ -r, 1 ]
    p = polyMul(p, [neg(r), ONE]);
  }
  return p;
}
