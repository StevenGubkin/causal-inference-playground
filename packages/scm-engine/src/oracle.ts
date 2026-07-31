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

function mutilatedDraw(model: Model, treatment: NodeId, treatmentValue: number, outcome: NodeId, rng: RNG): number {
  const scope: Record<NodeId, number> = {};
  for (const id of model.topoOrder) {
    if (id === treatment) {
      scope[id] = treatmentValue;
      continue;
    }
    const node = model.nodes.get(id)!;
    scope[id] = node.kind === 'deterministic' ? evalWithNoise(node.expr!, scope, rng) : sampleDistribution(node.dist!, scope, rng);
  }
  const outcomeValue = scope[outcome];
  if (outcomeValue === undefined) {
    throw new Error(`unknown outcome node "${outcome}"`);
  }
  return outcomeValue;
}

export function doResponse(model: Model, treatment: NodeId, outcome: NodeId, grid: number[], m: number, rng: RNG): Curve {
  const sums = grid.map(() => 0);

  for (let rep = 0; rep < m; rep++) {
    const repRng = rng.fork(`do-response-rep-${rep}`);
    const frozenNoise = repRng.snapshot();
    for (let gi = 0; gi < grid.length; gi++) {
      repRng.restore(frozenNoise); // CRN: identical exogenous draws at every grid point
      sums[gi]! += mutilatedDraw(model, treatment, grid[gi]!, outcome, repRng);
    }
  }

  return { xs: grid, ys: sums.map((sum) => sum / m) };
}

export function doContrast(model: Model, treatment: NodeId, outcome: NodeId, a: number, b: number, m: number, rng: RNG): number {
  const curve = doResponse(model, treatment, outcome, [a, b], m, rng);
  return curve.ys[1]! - curve.ys[0]!;
}
