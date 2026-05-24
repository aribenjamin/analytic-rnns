import type { Complex } from './complex';

export interface OptimalFit {
  k: number;
  poles: Complex[];
  residues: Complex[];
  /** Truncated training-loss value at this fit: ½ Σ_t (g_opt_t - g*_t)². */
  error: number;
}

export const FIXED_TARGET_POLES: Complex[] = [
  { re: 0.3000000000, im: 0.0000000000 },
  { re: 0.6000000000, im: 0.0000000000 },
  { re: 0.9000000000, im: 0.0000000000 },
];

export const FIXED_TARGET_RESIDUES: Complex[] = [
  { re: 1.0000000000, im: 0.0000000000 },
  { re: 1.0000000000, im: 0.0000000000 },
  { re: 1.0000000000, im: 0.0000000000 },
];

// Gram-loss optimal k-pole rational approximations to the target.
// ‖g*‖²_∞ (Gram) = 17.451135
// ‖g*‖²_T  (sum_0^159) = 17.451135
// k=1: poles=['0.7697'], L*_∞=3.452291e-01, L*_T=3.452291e-01
// k=2: poles=['0.8938', '0.4383'], L*_∞=8.768988e-04, L*_T=8.768988e-04
// k=3: poles=['0.3000', '0.6000', '0.9000'], L*_∞=-3.552714e-15, L*_T=1.152442e-15

export const OPTIMAL_FITS: OptimalFit[] = [
  { k: 1, error: 0.3452290903,
    poles: [{ re: 0.7697095486, im: 0.0000000000 }],
    residues: [{ re: 2.6135736630, im: 0.0000000000 }],
  },
  { k: 2, error: 0.0008768988,
    poles: [{ re: 0.8938243322, im: 0.0000000000 }, { re: 0.4383445983, im: 0.0000000000 }],
    residues: [{ re: 1.1153934796, im: 0.0000000000 }, { re: 1.8789877193, im: 0.0000000000 }],
  },
  { k: 3, error: 0.0000000000,
    poles: [{ re: 0.3000002856, im: 0.0000000000 }, { re: 0.6000001718, im: 0.0000000000 }, { re: 0.8999999961, im: 0.0000000000 }],
    residues: [{ re: 1.0000014742, im: 0.0000000000 }, { re: 0.9999984981, im: 0.0000000000 }, { re: 1.0000000246, im: 0.0000000000 }],
  },
];
