// ARCHITECTURE.md §6 — the interventional oracle.
//
// INVARIANT (intervention by mutilation): never evaluate the treatment's own
// structural equation; fix it, cut its incoming edges, and resample every
// downstream node.
// INVARIANT (common random numbers): reuse one frozen draw of all exogenous
// noise across the grid, so only the intervened node's downstream values
// change between grid points.
import type { Model, NodeId, RNG } from 'scm-dsl';
import { evalWithNoise, sampleDistribution } from './samplers.js';

export interface Curve {
  xs: number[];
  ys: number[];
}

/** The full mutilated scope -- every node's value under do(treatment=value),
 * not just the outcome. `doResponse`/`doContrast` only need one node back
 * out of this (the outcome), but `lateContrast` below needs to read off two
 * different nodes (the treatment, to detect compliance type, and the
 * outcome) from the same intervention, so the whole scope is the right
 * primitive to share. */
function mutilatedScope(model: Model, treatment: NodeId, treatmentValue: number, rng: RNG, noiseSD: number): Record<NodeId, number> {
  const scope: Record<NodeId, number> = {};
  for (const id of model.topoOrder) {
    if (id === treatment) {
      scope[id] = treatmentValue;
      continue;
    }
    const node = model.nodes.get(id)!;
    scope[id] = node.kind === 'deterministic' ? evalWithNoise(node.expr!, scope, rng, noiseSD) : sampleDistribution(node.dist!, scope, rng, noiseSD);
  }
  return scope;
}

function mutilatedDraw(model: Model, treatment: NodeId, treatmentValue: number, outcome: NodeId, rng: RNG, noiseSD: number): number {
  const outcomeValue = mutilatedScope(model, treatment, treatmentValue, rng, noiseSD)[outcome];
  if (outcomeValue === undefined) {
    throw new Error(`unknown outcome node "${outcome}"`);
  }
  return outcomeValue;
}

export function doResponse(model: Model, treatment: NodeId, outcome: NodeId, grid: number[], m: number, rng: RNG, noiseSD = 1): Curve {
  const sums = grid.map(() => 0);

  for (let rep = 0; rep < m; rep++) {
    const repRng = rng.fork(`do-response-rep-${rep}`);
    const frozenNoise = repRng.snapshot();
    for (let gi = 0; gi < grid.length; gi++) {
      repRng.restore(frozenNoise); // CRN: identical exogenous draws at every grid point
      sums[gi]! += mutilatedDraw(model, treatment, grid[gi]!, outcome, repRng, noiseSD);
    }
  }

  return { xs: grid, ys: sums.map((sum) => sum / m) };
}

export function doContrast(model: Model, treatment: NodeId, outcome: NodeId, a: number, b: number, m: number, rng: RNG, noiseSD = 1): number {
  const curve = doResponse(model, treatment, outcome, [a, b], m, rng, noiseSD);
  return curve.ys[1]! - curve.ys[0]!;
}

export interface LateResult {
  estimate: number;
  /** Fraction of the m replicates classified as compliers. Useful context
   * for reading the estimate -- a tiny complier share means few replicates
   * actually contributed to it. */
  complierShare: number;
}

/**
 * The true Local Average Treatment Effect: the population average of
 * Y(do(D=1)) - Y(do(D=0)), restricted to compliers -- units whose treatment
 * would differ under instrument=0 vs instrument=1 (D(Z=1) > D(Z=0), the
 * monotonicity-consistent definition; units whose D doesn't respond to Z,
 * or responds the "wrong way", are excluded). This is the estimand 2SLS
 * actually targets under effect heterogeneity, as distinct from
 * doContrast's population ATE -- see METHODS.md's "Worked construction:
 * compliance heterogeneity". Assumes a binary treatment and binary
 * instrument (0/1), matching the scope of the LATE story itself.
 *
 * Each replicate draws one frozen noise state and reuses it for all four
 * mutilated scopes (do(Z=0), do(Z=1), do(D=0), do(D=1)) -- same common-
 * random-numbers principle as doResponse, so all four describe "the same
 * hypothetical unit" under different interventions, not four independent
 * draws.
 */
export function lateContrast(model: Model, treatment: NodeId, outcome: NodeId, instrument: NodeId, m: number, rng: RNG, noiseSD = 1): LateResult {
  let sumDiff = 0;
  let complierCount = 0;

  for (let rep = 0; rep < m; rep++) {
    const repRng = rng.fork(`late-rep-${rep}`);
    const frozenNoise = repRng.snapshot();

    repRng.restore(frozenNoise);
    const atInstrument0 = mutilatedScope(model, instrument, 0, repRng, noiseSD);
    repRng.restore(frozenNoise);
    const atInstrument1 = mutilatedScope(model, instrument, 1, repRng, noiseSD);

    const treatmentAtZ0 = atInstrument0[treatment];
    const treatmentAtZ1 = atInstrument1[treatment];
    if (treatmentAtZ0 === undefined || treatmentAtZ1 === undefined) {
      throw new Error(`unknown treatment node "${treatment}"`);
    }
    if (treatmentAtZ1 <= treatmentAtZ0) continue; // never-taker, always-taker, or a defier under broken monotonicity

    repRng.restore(frozenNoise);
    const atTreatment0 = mutilatedScope(model, treatment, 0, repRng, noiseSD);
    repRng.restore(frozenNoise);
    const atTreatment1 = mutilatedScope(model, treatment, 1, repRng, noiseSD);

    const outcomeAtD0 = atTreatment0[outcome];
    const outcomeAtD1 = atTreatment1[outcome];
    if (outcomeAtD0 === undefined || outcomeAtD1 === undefined) {
      throw new Error(`unknown outcome node "${outcome}"`);
    }
    sumDiff += outcomeAtD1 - outcomeAtD0;
    complierCount++;
  }

  return {
    estimate: complierCount > 0 ? sumDiff / complierCount : NaN,
    complierShare: complierCount / m,
  };
}
