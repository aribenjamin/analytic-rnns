import { describe, it, expect } from 'vitest';
import {
  c,
  add,
  sub,
  mul,
  div,
  abs,
  arg,
  expi,
  exp,
  polyVal,
  polyMul,
  polyAdd,
  fromRoots,
  ZERO,
  ONE,
  I,
} from './complex';

describe('complex arithmetic', () => {
  it('basic ops', () => {
    expect(add(c(1, 2), c(3, 4))).toEqual({ re: 4, im: 6 });
    expect(sub(c(1, 2), c(3, 4))).toEqual({ re: -2, im: -2 });
    expect(mul(c(1, 2), c(3, 4))).toEqual({ re: 1 * 3 - 2 * 4, im: 1 * 4 + 2 * 3 });
    // div: (1+2i)/(3+4i) = (1+2i)(3-4i)/(3^2+4^2) = (3+8 + i(6-4))/25 = (11+2i)/25
    const q = div(c(1, 2), c(3, 4));
    expect(q.re).toBeCloseTo(11 / 25, 12);
    expect(q.im).toBeCloseTo(2 / 25, 12);
  });

  it('abs and arg', () => {
    expect(abs(c(3, 4))).toBeCloseTo(5, 12);
    expect(arg(c(0, 1))).toBeCloseTo(Math.PI / 2, 12);
  });

  it('expi and exp', () => {
    expect(expi(0)).toEqual({ re: 1, im: 0 });
    const e = expi(Math.PI);
    expect(e.re).toBeCloseTo(-1, 12);
    expect(e.im).toBeCloseTo(0, 12);
    expect(exp(I).re).toBeCloseTo(Math.cos(1), 12);
    expect(exp(I).im).toBeCloseTo(Math.sin(1), 12);
  });
});

describe('polynomial operations', () => {
  it('polyVal evaluates p(z) = 1 + 2z + 3z^2 at z=2 → 1+4+12 = 17', () => {
    const p = [c(1), c(2), c(3)];
    const v = polyVal(p, c(2));
    expect(v.re).toBeCloseTo(17, 12);
    expect(v.im).toBeCloseTo(0, 12);
  });

  it('polyMul: (1+z)(1+z) = 1 + 2z + z^2', () => {
    const p = polyMul([c(1), c(1)], [c(1), c(1)]);
    expect(p.map((x) => x.re)).toEqual([1, 2, 1]);
  });

  it('fromRoots: roots {1, -1} → 1 - z^2 (i.e. -1 + 0z + z^2 with sign... actually (z-1)(z+1) = z^2 - 1)', () => {
    const p = fromRoots([c(1), c(-1)]);
    // (z - 1)(z - (-1)) = (z-1)(z+1) = z^2 - 1
    // ascending: [-1, 0, 1]
    expect(p.length).toBe(3);
    expect(p[0].re).toBeCloseTo(-1, 12);
    expect(p[1].re).toBeCloseTo(0, 12);
    expect(p[2].re).toBeCloseTo(1, 12);
  });

  it('fromRoots: roots {i, -i} → z^2 + 1', () => {
    const p = fromRoots([c(0, 1), c(0, -1)]);
    expect(p[0].re).toBeCloseTo(1, 12);
    expect(p[0].im).toBeCloseTo(0, 12);
    expect(p[2].re).toBeCloseTo(1, 12);
  });
});
