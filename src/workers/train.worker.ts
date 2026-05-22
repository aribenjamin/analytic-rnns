/*
 * Web worker for the §7 DecodedStaircase widget.  Runs the gradient flow on
 * the main thread's behalf and streams back log-spaced trace snapshots so
 * the UI stays responsive even when total step counts are tens of thousands.
 *
 * Two paths:
 *   mode = 'modal'  — Phase-A modal gradient flow on (α, β) at fixed poles.
 *   mode = 'direct' — Phase-B direct (W, b, c) BPTT; eigenvalues of W drift.
 *
 * Protocol:
 *   main → worker: { kind: 'run', config: TrainConfig }
 *   worker → main: { kind: 'trace', trace: TraceSnapshot[] }
 *                  { kind: 'done' }
 */

import {
  defaultTarget,
  init,
  simulateTrajectory,
  type ModalTarget,
  type TraceSnapshot,
} from '../lib/gradientFlow';
import {
  initWBC,
  simulateTrajectoryWBC,
  randomTarget,
  totalDimOfModes,
} from '../lib/rnnTrain';

export interface TrainConfig {
  mode?: 'modal' | 'direct';
  /** If omitted, uses defaultTarget(T) in modal mode or randomTarget(...) in
   *  direct mode. */
  target?: ModalTarget;
  T?: number;
  initScale: number;
  seed: number;
  /** Network dimension for direct mode. If omitted, inferred from target.modes. */
  n?: number;
  dt: number;
  steps: number;
  snapshots: number;
  rhoThreshold: number;
  /** Optional input sequence for the direct trainer. Defaults to impulse. */
  input?: number[];
  /** Optional target output for the chosen input. Defaults to target.gStar. */
  yStar?: number[];
}

export type TrainMsg = { kind: 'run'; config: TrainConfig };
export type TrainResponse =
  | { kind: 'trace'; trace: TraceSnapshot[] }
  | { kind: 'done' };

self.onmessage = (ev: MessageEvent<TrainMsg>) => {
  const msg = ev.data;
  if (msg.kind !== 'run') return;
  const cfg = msg.config;
  const mode = cfg.mode ?? 'modal';
  let trace: TraceSnapshot[];

  if (mode === 'direct') {
    const T = cfg.T ?? cfg.target?.T ?? 160;
    const target = cfg.target ?? randomTarget({ totalDim: cfg.n ?? 4, T, seed: cfg.seed });
    const n = cfg.n ?? totalDimOfModes(target.modes);
    const rnn0 = initWBC(n, cfg.initScale, cfg.seed);
    trace = simulateTrajectoryWBC(rnn0, target, {
      dt: cfg.dt,
      steps: cfg.steps,
      snapshots: cfg.snapshots,
      rhoThreshold: cfg.rhoThreshold,
      input: cfg.input,
      yStar: cfg.yStar,
    });
  } else {
    const target = cfg.target ?? defaultTarget(cfg.T ?? 160);
    const s0 = init(target, { scale: cfg.initScale, seed: cfg.seed });
    trace = simulateTrajectory(s0, target, {
      dt: cfg.dt,
      steps: cfg.steps,
      snapshots: cfg.snapshots,
      rhoThreshold: cfg.rhoThreshold,
    });
  }

  const out: TrainResponse = { kind: 'trace', trace };
  (self as unknown as Worker).postMessage(out);
  (self as unknown as Worker).postMessage({ kind: 'done' } as TrainResponse);
};
