// ARCHITECTURE.md §9 — ancestors/descendants and d-separation.
//
// Design note: §9 was drafted assuming an abstract ADMG needing special-cased
// "bidirected path" handling. Our Model IR doesn't need that -- every
// confounder (from `latent`, `noise`, or `<->`) is materialized as a real
// latent Node with ordinary directed edges to its children, so this is just
// standard DAG d-separation via the textbook moralization method
// (Lauritzen/Dawid/Larsen/Leimer 1990): take the ancestral set of
// {x, y} ∪ given, moralize it (marry co-parents), drop edge direction, and
// check whether `given` separates x from y in the resulting undirected graph.
import type { Model, NodeId } from 'scm-dsl';

export type ParentsFn = (id: NodeId) => readonly NodeId[];

export function modelParentsFn(model: Model): ParentsFn {
  return (id) => model.parentsOf(id);
}

function modelChildrenFn(model: Model): ParentsFn {
  return (id) => model.childrenOf(id);
}

/** A view of `parentsOf` with every edge *into* `cutTo` from `treatment`
 * removed -- i.e. `treatment`'s outgoing edges are gone. Used by
 * `backdoorValid` to check for open backdoor paths (paths that don't start
 * by leaving `treatment` through its own structural equation). */
export function withOutgoingEdgesRemoved(parentsOf: ParentsFn, treatment: NodeId): ParentsFn {
  return (id) => parentsOf(id).filter((p) => p !== treatment);
}

function reachableVia(fn: ParentsFn, starts: Iterable<NodeId>): Set<NodeId> {
  const visited = new Set<NodeId>();
  const stack = [...starts];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of fn(current)) {
      if (!visited.has(next)) {
        visited.add(next);
        stack.push(next);
      }
    }
  }
  return visited;
}

/** Union of the ancestors of every node in `nodes` (not including the
 * starting nodes themselves). */
export function ancestors(model: Model, nodes: ReadonlySet<NodeId>): Set<NodeId> {
  return reachableVia(modelParentsFn(model), nodes);
}

/** Union of the descendants of every node in `nodes` (not including the
 * starting nodes themselves). */
export function descendants(model: Model, nodes: ReadonlySet<NodeId>): Set<NodeId> {
  return reachableVia(modelChildrenFn(model), nodes);
}

/** d-separation over an arbitrary `parentsOf`-shaped view, so callers (e.g.
 * `backdoorValid`) can pass a mutilated graph without needing a second
 * concrete graph representation. */
export function dSeparatedOverParents(parentsOf: ParentsFn, x: NodeId, y: NodeId, given: ReadonlySet<NodeId>): boolean {
  // 1. Ancestral set of {x, y} ∪ given.
  const seeds = new Set([x, y, ...given]);
  const relevant = new Set(seeds);
  for (const anc of reachableVia(parentsOf, seeds)) relevant.add(anc);

  // 2. Moralize: undirected edge to each parent (restricted to `relevant`),
  // plus "marry" every pair of co-parents (this is what correctly opens a
  // collider path once the collider or a descendant of it is in `relevant`).
  const adjacency = new Map<NodeId, Set<NodeId>>();
  function link(a: NodeId, b: NodeId): void {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  }
  for (const node of relevant) {
    const parents = parentsOf(node).filter((p) => relevant.has(p));
    for (const p of parents) link(node, p);
    for (let i = 0; i < parents.length; i++) {
      for (let j = i + 1; j < parents.length; j++) link(parents[i]!, parents[j]!);
    }
  }

  // 3. x, y are d-separated by `given` iff no path connects them in the
  // moralized undirected graph after deleting every node in `given`.
  const visited = new Set<NodeId>([x]);
  const stack = [x];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const next of adjacency.get(current) ?? []) {
      if (given.has(next)) continue;
      if (!visited.has(next)) {
        visited.add(next);
        stack.push(next);
      }
    }
  }
  return !visited.has(y);
}

export function dSeparated(model: Model, x: NodeId, y: NodeId, given: ReadonlySet<NodeId>): boolean {
  return dSeparatedOverParents(modelParentsFn(model), x, y, given);
}
