// ARCHITECTURE.md §9 — instrument validity, matching §9's documented
// signature order (model, x, y, iv, given).
import type { Model, NodeId } from 'scm-dsl';
import { dSeparated, dSeparatedOverParents, modelParentsFn, withOutgoingEdgesRemoved } from './dsep.js';
import type { ValidityResult } from './backdoor.js';

/**
 * Two graphical conditions for `iv` to be a valid instrument for the effect
 * of `x` on `y`:
 *
 * - **Relevance**: `iv` must be associated with `x` -- i.e. not d-separated
 *   from it given `given`.
 * - **Exclusion + instrument-unconfoundedness, checked in one step**: cut
 *   `x`'s outgoing edges (the same mutilation `backdoorValid` uses) and
 *   verify `iv` and `y` are d-separated. If `iv`'s only path to `y` ran
 *   through `x`, removing `x`'s out-edges removes that one legitimate path
 *   and nothing else should connect them; any other path (a direct edge, a
 *   shared confounder) stays open and correctly fails this check.
 */
export function instrumentValid(model: Model, x: NodeId, y: NodeId, iv: NodeId, given: ReadonlySet<NodeId> = new Set()): ValidityResult {
  if (dSeparated(model, iv, x, given)) {
    return {
      ok: false,
      reason: `"${iv}" has no association with "${x}" given the current adjustment set (fails relevance)`,
    };
  }

  const withoutXOutEdges = withOutgoingEdgesRemoved(modelParentsFn(model), x);
  if (!dSeparatedOverParents(withoutXOutEdges, iv, y, given)) {
    return {
      ok: false,
      reason: `"${iv}" has a path to "${y}" that doesn't run through "${x}" (fails exclusion / instrument independence)`,
    };
  }

  return { ok: true };
}
