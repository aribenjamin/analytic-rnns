import { describe, it, expect } from 'vitest';
import { dct2, idct2 } from './dct';

describe('dct2 / idct2 — orthonormal 2D cosine transform', () => {
  it('round-trips an arbitrary image', () => {
    const n = 8;
    const img = Array.from({ length: n * n }, (_, i) => Math.sin(i) * 0.5 + (i % 5));
    const back = idct2(dct2(img, n), n);
    for (let i = 0; i < img.length; i++) expect(back[i]).toBeCloseTo(img[i], 10);
  });

  it('puts a constant image entirely in the DC coefficient', () => {
    // Hand-derivation: the orthonormal 1D DCT-II of a length-n constant c is
    // c*sqrt(n) in the k=0 slot and 0 elsewhere. Separable over two axes
    // gives a single 2D coefficient C[0,0] = c*n.
    const n = 4;
    const c = 0.7;
    const img = new Array(n * n).fill(c);
    const C = dct2(img, n);
    expect(C[0]).toBeCloseTo(c * n, 12);
    for (let i = 1; i < C.length; i++) expect(C[i]).toBeCloseTo(0, 12);
  });

  it('matches a hand-computed 2x2 transform', () => {
    // n=2 orthonormal DCT-II of a constant tile [[1,1],[1,1]]: each row maps
    // to [sqrt2, 0], then each column maps [sqrt2,sqrt2] -> [2,0]. So the
    // only nonzero coefficient is C[0,0] = 2.
    const C = dct2([1, 1, 1, 1], 2);
    expect(C[0]).toBeCloseTo(2, 12);
    expect(C[1]).toBeCloseTo(0, 12);
    expect(C[2]).toBeCloseTo(0, 12);
    expect(C[3]).toBeCloseTo(0, 12);

    // A left-right step [[1,-1],[1,-1]]: each row -> [0, sqrt2], then the
    // second column [sqrt2,sqrt2] -> [2,0]. Only C[0,1] = 2 survives.
    const C2 = dct2([1, -1, 1, -1], 2);
    expect(C2[0]).toBeCloseTo(0, 12);
    expect(C2[1]).toBeCloseTo(2, 12);
    expect(C2[2]).toBeCloseTo(0, 12);
    expect(C2[3]).toBeCloseTo(0, 12);
  });

  it('preserves total energy (Parseval)', () => {
    const n = 6;
    const img = Array.from({ length: n * n }, (_, i) => ((i * 37) % 19) - 9);
    const C = dct2(img, n);
    const eImg = img.reduce((s, v) => s + v * v, 0);
    const eC = C.reduce((s, v) => s + v * v, 0);
    expect(eC).toBeCloseTo(eImg, 8);
  });

  it('isolates a single cosine mode', () => {
    // The image equal to one DCT basis function (the inverse transform of a
    // unit coefficient at (u,v)=(2,1)) must transform back to that delta.
    const n = 8;
    const idx = 2 * n + 1;
    const coeffs = new Array(n * n).fill(0);
    coeffs[idx] = 1;
    const basis = idct2(coeffs, n);
    const C = dct2(basis, n);
    for (let i = 0; i < C.length; i++) {
      expect(C[i]).toBeCloseTo(i === idx ? 1 : 0, 9);
    }
  });
});
