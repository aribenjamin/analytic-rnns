// Closed-form gradient-flow solution for a two-layer linear network
// y = W2 W1 x trained on a low-rank target with diagonal singular spectrum
// diag(sigmaStar_k). In the joint singular basis each mode evolves as
//   sigma_k(tau) = sigmaStar / ( 1 + (sigmaStar/sigma0 - 1) * exp(-2 sigmaStar tau / kappa) )
// (Saxe, McClelland, Ganguli 2013, "Exact solutions to the nonlinear dynamics
// of learning in deep linear neural networks").

export interface SaxeTrajectory {
  tau: number[];
  /** sigmas[k][t] = sigma_k at tau[t]. */
  sigmas: number[][];
  /** Loss (1/2) sum_k (sigma_k(tau) - sigma_k*)^2. */
  loss: number[];
}

export function sigmaAt(
  sigmaStar: number,
  sigma0: number,
  tau: number,
  kappa = 1,
): number {
  if (sigmaStar === 0) return 0;
  const r = sigmaStar / sigma0;
  // Stable form: avoid blowups when 2 s* tau / kappa is large.
  const e = Math.exp(-2 * sigmaStar * tau / kappa);
  return sigmaStar / (1 + (r - 1) * e);
}

export function trajectory(
  sigmaStars: number[],
  sigma0: number,
  tauMax: number,
  steps: number,
  kappa = 1,
): SaxeTrajectory {
  const tau: number[] = new Array(steps);
  const sigmas: number[][] = sigmaStars.map(() => new Array(steps));
  const loss: number[] = new Array(steps);
  for (let t = 0; t < steps; t++) {
    const ti = (tauMax * t) / Math.max(1, steps - 1);
    tau[t] = ti;
    let L = 0;
    for (let k = 0; k < sigmaStars.length; k++) {
      const s = sigmaAt(sigmaStars[k], sigma0, ti, kappa);
      sigmas[k][t] = s;
      const d = s - sigmaStars[k];
      L += 0.5 * d * d;
    }
    loss[t] = L;
  }
  return { tau, sigmas, loss };
}
