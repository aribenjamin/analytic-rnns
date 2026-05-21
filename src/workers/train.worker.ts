/*
 * Web worker for the §7 DecodedStaircase widget.  Runs the gradient flow on
 * the main thread's behalf and streams back log-spaced trace snapshots so
 * the UI stays responsive even when total step counts are tens of thousands.
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
} from '../lib/gradientFlow';

export interface TrainConfig {
  /** If omitted, uses defaultTarget(T). */
  target?: ModalTarget;
  T?: number;
  initScale: number;
  seed: number;
  dt: number;
  steps: number;
  snapshots: number;
  rhoThreshold: number;
}

export type TrainMsg = { kind: 'run'; config: TrainConfig };
export type TrainResponse =
  | { kind: 'trace'; trace: ReturnType<typeof simulateTrajectory> }
  | { kind: 'done' };

self.onmessage = (ev: MessageEvent<TrainMsg>) => {
  const msg = ev.data;
  if (msg.kind !== 'run') return;
  const cfg = msg.config;
  const target = cfg.target ?? defaultTarget(cfg.T ?? 160);
  const s0 = init(target, { scale: cfg.initScale, seed: cfg.seed });
  const trace = simulateTrajectory(s0, target, {
    dt: cfg.dt,
    steps: cfg.steps,
    snapshots: cfg.snapshots,
    rhoThreshold: cfg.rhoThreshold,
  });
  const out: TrainResponse = { kind: 'trace', trace };
  (self as unknown as Worker).postMessage(out);
  (self as unknown as Worker).postMessage({ kind: 'done' } as TrainResponse);
};
