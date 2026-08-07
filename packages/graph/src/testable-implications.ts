// ARCHITECTURE.md §9 — the set of conditional-independence statements a DAG
// implies, restricted to observed nodes (the ones a real dataset could
// actually test against).
import type { Model, NodeId } from 'scm-dsl';
import { dSeparated } from './dsep.js';
import { subsetsSmallestFirst } from './subsets.js';

export interface CIStatement {
  x: NodeId;
  y: NodeId;
  given: NodeId[];
}

/** One minimal separating set (among observed nodes) per non-adjacent pair
 * of observed nodes -- the CI statements a real dataset could test. Pairs
 * with no separating observed subset (e.g. connected only through an
 * unobserved confounder, with no observed mediator) are omitted, not an
 * error: they're genuinely not testable from observed data alone. */
export function testableImplications(model: Model): CIStatement[] {
  const observed = model.observed();
  const statements: CIStatement[] = [];

  for (let i = 0; i < observed.length; i++) {
    for (let j = i + 1; j < observed.length; j++) {
      const x = observed[i]!;
      const y = observed[j]!;
      if (model.parentsOf(x).includes(y) || model.parentsOf(y).includes(x)) continue; // adjacent -- no CI statement

      const candidates = observed.filter((id) => id !== x && id !== y);
      if (candidates.length > 20) continue; // same defensive cap as findBackdoorSet

      for (const subset of subsetsSmallestFirst(candidates)) {
        if (dSeparated(model, x, y, new Set(subset))) {
          statements.push({ x, y, given: subset });
          break;
        }
      }
    }
  }
  return statements;
}
