// ARCHITECTURE.md §9 — the backdoor criterion (Pearl).
import type { Model, NodeId } from 'scm-dsl';
import { dSeparatedOverParents, descendants, modelParentsFn, withOutgoingEdgesRemoved } from './dsep.js';

export interface ValidityResult {
  ok: boolean;
  reason?: string;
}

/**
 * Pearl's backdoor criterion: `z` is a valid adjustment set for the effect
 * of `x` on `y` iff (a) no member of `z` is a descendant of `x`, and (b) `z`
 * blocks every backdoor path from `x` to `y` -- checked as d-separation
 * between `x` and `y` given `z`, in the graph with `x`'s outgoing edges cut
 * (so only paths that enter `x`, not ones that start by leaving it, count).
 */
export function backdoorValid(model: Model, x: NodeId, y: NodeId, z: ReadonlySet<NodeId>): ValidityResult {
  const xDescendants = descendants(model, new Set([x]));
  for (const zi of z) {
    if (xDescendants.has(zi)) {
      return {
        ok: false,
        reason: `"${zi}" is a descendant of "${x}" — adjusting for it can distort or block the very effect being measured`,
      };
    }
  }

  const mutilatedParents = withOutgoingEdgesRemoved(modelParentsFn(model), x);
  if (!dSeparatedOverParents(mutilatedParents, x, y, z)) {
    return {
      ok: false,
      reason: `an open backdoor path remains between "${x}" and "${y}" given {${[...z].join(', ')}}`,
    };
  }

  return { ok: true };
}

function popcount(n: number): number {
  let count = 0;
  let value = n;
  while (value > 0) {
    count += value & 1;
    value >>= 1;
  }
  return count;
}

/**
 * Brute-force search over subsets of observed non-descendants of `x` (other
 * than `x`/`y` themselves) for one satisfying `backdoorValid`, smallest
 * first. Defensively bounded -- not a real concern at the candidate counts
 * any of our example models have.
 */
export function findBackdoorSet(model: Model, x: NodeId, y: NodeId): NodeId[] | null {
  const xDescendants = descendants(model, new Set([x]));
  const candidates = model.observed().filter((id) => id !== x && id !== y && !xDescendants.has(id));
  if (candidates.length > 20) return null;

  const n = candidates.length;
  const masks = Array.from({ length: 1 << n }, (_, m) => m).sort((a, b) => popcount(a) - popcount(b));
  for (const mask of masks) {
    const subset = candidates.filter((_, i) => (mask & (1 << i)) !== 0);
    if (backdoorValid(model, x, y, new Set(subset)).ok) return subset;
  }
  return null;
}
