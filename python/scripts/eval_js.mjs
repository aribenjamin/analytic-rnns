// Reads a JSON config from stdin, calls the JS reference lib, writes JSON to
// stdout. Invoked from python/tests/test_parity.py via `npx tsx`. We use tsx
// because Node's native --experimental-strip-types does not auto-resolve
// extensionless ESM specifiers (e.g. `import './complex'`), and the JS source
// uses extensionless imports throughout.
//
// Input shape:
//   { systems: [ { poles: [{re,im}], residues: [{re,im}],
//                  grid: [{re,im}, ...], impulseT: int,
//                  simulateInput: number[], freqN: int } ],
//   }
// Output: { systems: [ { evalGrid, impulse, zeros, residuesOut, numerator,
//                        denominator, separations, freq, sim } ] }

import { readFileSync } from "node:fs";
import {
  evalH,
  impulseResponse,
  zeros as jsZeros,
  numeratorPoly,
  denominatorPoly,
  poleZeroSeparation,
  frequencyResponse,
  simulate,
} from "../../src/lib/transferFn.ts";

const raw = readFileSync(0, "utf8");
const cfg = JSON.parse(raw);

function cArr(arr) {
  return arr.map((v) => ({ re: v.re, im: v.im }));
}

const out = { systems: [] };
for (const s of cfg.systems) {
  const sys = { poles: cArr(s.poles), residues: cArr(s.residues) };
  const evalGrid = (s.grid ?? []).map((z) => {
    const v = evalH(sys, { re: z.re, im: z.im });
    return { re: v.re, im: v.im };
  });
  const impulse = impulseResponse(sys, s.impulseT ?? 0);
  const zs = jsZeros(sys).map((z) => ({ re: z.re, im: z.im }));
  const num = numeratorPoly(sys).map((z) => ({ re: z.re, im: z.im }));
  const den = denominatorPoly(sys).map((z) => ({ re: z.re, im: z.im }));
  const seps = poleZeroSeparation(sys);
  const { theta, H } = frequencyResponse(sys, s.freqN ?? 0);
  const freq = {
    theta,
    H: H.map((z) => ({ re: z.re, im: z.im })),
  };
  const sim = simulate(sys, s.simulateInput ?? []);
  out.systems.push({
    evalGrid,
    impulse,
    zeros: zs,
    numerator: num,
    denominator: den,
    separations: seps,
    freq,
    sim,
  });
}
process.stdout.write(JSON.stringify(out));
