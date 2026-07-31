// ARCHITECTURE.md §6/§7 — forward sampling and the observed/latent boundary.
import type { Model, NodeId, RNG } from 'scm-dsl';
import { evalWithNoise, sampleDistribution } from './samplers.js';

export interface ObservedSample {
  n: number;
  columns: Map<NodeId, Float64Array>;
}

export interface Sample {
  n: number;
  columns: Map<NodeId, Float64Array>;
  observed(): ObservedSample;
}

export function forwardSample(model: Model, n: number, rng: RNG): Sample {
  const columns = new Map<NodeId, Float64Array>();
  for (const id of model.topoOrder) columns.set(id, new Float64Array(n));

  for (let row = 0; row < n; row++) {
    const scope: Record<NodeId, number> = {};
    for (const id of model.topoOrder) {
      const node = model.nodes.get(id)!;
      const value = node.kind === 'deterministic' ? evalWithNoise(node.expr!, scope, rng) : sampleDistribution(node.dist!, scope, rng);
      scope[id] = value;
      columns.get(id)![row] = value;
    }
  }

  return {
    n,
    columns,
    // INVARIANT (latent stripping, §7): estimators only ever see this.
    observed(): ObservedSample {
      const observedColumns = new Map<NodeId, Float64Array>();
      for (const id of model.observed()) observedColumns.set(id, columns.get(id)!);
      return { n, columns: observedColumns };
    },
  };
}
