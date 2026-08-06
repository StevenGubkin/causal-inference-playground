import type { NodeId, RNG } from 'scm-dsl';
import type { ObservedSample } from 'scm-engine';

/** Nonparametric bootstrap resample: draw `n` row indices with replacement,
 * rebuild every column at those indices. Preserves row-wise structure across
 * columns (the same drawn index is used for every column on a given output
 * row) -- a valid resample of the joint distribution, not independently
 * shuffled columns. */
export function resampleRows(observed: ObservedSample, rng: RNG): ObservedSample {
  const n = observed.n;
  const indices = new Array<number>(n);
  for (let i = 0; i < n; i++) indices[i] = Math.floor(rng.next() * n);

  const columns = new Map<NodeId, Float64Array>();
  for (const [id, col] of observed.columns) {
    const resampled = new Float64Array(n);
    for (let i = 0; i < n; i++) resampled[i] = col[indices[i]!]!;
    columns.set(id, resampled);
  }
  return { n, columns };
}

/** Leave-one-out resample for the jackknife: drop row `i`, keep every other
 * row in its original order. Deterministic (no RNG) -- BCa's acceleration
 * term needs exactly one leave-one-out estimate per observation, not a
 * random draw. */
export function leaveOneOut(observed: ObservedSample, i: number): ObservedSample {
  const n = observed.n;
  const columns = new Map<NodeId, Float64Array>();
  for (const [id, col] of observed.columns) {
    const dropped = new Float64Array(n - 1);
    let w = 0;
    for (let r = 0; r < n; r++) {
      if (r !== i) dropped[w++] = col[r]!;
    }
    columns.set(id, dropped);
  }
  return { n: n - 1, columns };
}
