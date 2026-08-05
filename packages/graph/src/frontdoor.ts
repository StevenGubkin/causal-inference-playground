// ARCHITECTURE.md §9 / METHODS.md §4 — the front-door criterion (Pearl).
// Three conditions, each reusing an existing primitive rather than
// re-deriving its own graph traversal:
//   (a) M fully mediates X -> Y: every directed path from X to Y passes
//       through some node in M.
//   (b) No unblocked backdoor path from X to M: this is exactly what
//       backdoorValid(model, x, mi, {}) already checks (its
//       descendant-of-x rejection is trivially satisfied by an empty z).
//   (c) The only backdoor path from M to Y runs through X: this is exactly
//       backdoorValid(model, mi, y, {x} union (M minus mi)) -- X plus the
//       rest of the mediator set must be a valid backdoor-blocking set for
//       mi's effect on y.
import type { Model, NodeId } from 'scm-dsl';
import { backdoorValid } from './backdoor.js';
import type { ValidityResult } from './backdoor.js';
import { modelChildrenFn, reachableVia } from './dsep.js';

export function frontdoorValid(model: Model, x: NodeId, y: NodeId, m: ReadonlySet<NodeId>): ValidityResult {
  if (m.size === 0) {
    return { ok: false, reason: 'a front-door adjustment needs at least one mediator' };
  }

  // (a) some directed path from x to y survives even with every mediator
  // node treated as a dead end -- i.e. it bypasses the mediator set.
  if (reachableVia(modelChildrenFn(model), [x], m).has(y)) {
    return {
      ok: false,
      reason: `a directed path from "${x}" to "${y}" bypasses the mediator set {${[...m].join(', ')}}`,
    };
  }

  for (const mi of m) {
    // (b) no unblocked backdoor path from x to mi.
    const xToM = backdoorValid(model, x, mi, new Set());
    if (!xToM.ok) {
      return {
        ok: false,
        reason: `an open backdoor path remains between "${x}" and mediator "${mi}"`,
      };
    }

    // (c) x (plus the rest of the mediator set) blocks every backdoor path
    // from mi to y.
    const otherMediators = [...m].filter((id) => id !== mi);
    const mToY = backdoorValid(model, mi, y, new Set([x, ...otherMediators]));
    if (!mToY.ok) {
      return {
        ok: false,
        reason: `an open backdoor path remains between mediator "${mi}" and "${y}" given {${[x, ...otherMediators].join(', ')}}`,
      };
    }
  }

  return { ok: true };
}
