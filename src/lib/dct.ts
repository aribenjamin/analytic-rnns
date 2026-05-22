// Separable 2D DCT-II and its inverse (DCT-III), orthonormal normalization.
// Orthonormality makes the inverse the exact transpose of the forward
// transform, so round-trips are exact and Parseval (energy preservation)
// holds: sum of squared coefficients == sum of squared pixels.
//
// Used by the §1 widget to write a grayscale image in a cosine basis. The
// 2D cosine basis is a faithful stand-in for the principal components of
// natural images — the same fact JPEG exploits — so a network learning the
// image mode-by-mode learns it cosine-by-cosine, low spatial frequency first.
//
// Images are passed as flat row-major arrays of length n*n.

type Transform1D = (input: Float64Array, n: number) => Float64Array;

function dct1(input: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  const norm0 = Math.sqrt(1 / n);
  const normK = Math.sqrt(2 / n);
  for (let k = 0; k < n; k++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += input[j] * Math.cos((Math.PI * (2 * j + 1) * k) / (2 * n));
    }
    out[k] = (k === 0 ? norm0 : normK) * sum;
  }
  return out;
}

function idct1(input: Float64Array, n: number): Float64Array {
  const out = new Float64Array(n);
  const norm0 = Math.sqrt(1 / n);
  const normK = Math.sqrt(2 / n);
  for (let j = 0; j < n; j++) {
    let sum = norm0 * input[0];
    for (let k = 1; k < n; k++) {
      sum += normK * input[k] * Math.cos((Math.PI * (2 * j + 1) * k) / (2 * n));
    }
    out[j] = sum;
  }
  return out;
}

function applyRows(data: number[], n: number, t: Transform1D): number[] {
  const out = new Array<number>(n * n);
  const row = new Float64Array(n);
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) row[c] = data[r * n + c];
    const transformed = t(row, n);
    for (let c = 0; c < n; c++) out[r * n + c] = transformed[c];
  }
  return out;
}

function applyCols(data: number[], n: number, t: Transform1D): number[] {
  const out = new Array<number>(n * n);
  const col = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    for (let r = 0; r < n; r++) col[r] = data[r * n + c];
    const transformed = t(col, n);
    for (let r = 0; r < n; r++) out[r * n + c] = transformed[r];
  }
  return out;
}

/** Forward 2D DCT-II. `image` is row-major length n*n; returns coefficients. */
export function dct2(image: number[], n: number): number[] {
  return applyCols(applyRows(image, n, dct1), n, dct1);
}

/** Inverse 2D DCT (DCT-III). `coeffs` is row-major length n*n; returns pixels. */
export function idct2(coeffs: number[], n: number): number[] {
  return applyCols(applyRows(coeffs, n, idct1), n, idct1);
}
