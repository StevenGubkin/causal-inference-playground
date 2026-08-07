import type { NodeId } from 'scm-dsl';

function popcount(n: number): number {
  let count = 0;
  let value = n;
  while (value > 0) {
    count += value & 1;
    value >>= 1;
  }
  return count;
}

/** Every subset of `candidates`, smallest first (ties broken by mask order).
 * Defensively unbounded here -- callers cap `candidates.length` themselves
 * (both current call sites use `> 20`, not a concern at example-model scale). */
export function subsetsSmallestFirst(candidates: NodeId[]): NodeId[][] {
  const n = candidates.length;
  const masks = Array.from({ length: 1 << n }, (_, m) => m).sort((a, b) => popcount(a) - popcount(b));
  return masks.map((mask) => candidates.filter((_, i) => (mask & (1 << i)) !== 0));
}
