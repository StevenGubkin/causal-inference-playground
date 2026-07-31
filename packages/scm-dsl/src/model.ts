// ARCHITECTURE.md §5 — Model IR and distributions.
//
// The RNG *interface* lives here (scm-dsl) because Distribution.sample()'s
// signature needs it, and scm-dsl must not depend on scm-engine (one-way
// dependency chain, ARCHITECTURE.md §3). The concrete seeded PCG/xorshift
// *implementation* lives in scm-engine (§6, §17 Phase 1) — scm-dsl only
// promises the shape.

export type NodeId = string;
export type Visibility = 'observed' | 'latent';
export type NodeKind = 'deterministic' | 'stochastic';

export type RNGState = unknown;

export interface RNG {
  next(): number;
  normal(): number;
  fork(streamId: string): RNG;
  snapshot(): RNGState;
  restore(state: RNGState): void;
}

export interface CompiledExpr {
  parents: NodeId[];
  usesNoise: boolean;
  eval(scope: Record<string, number>): number;
}

export interface Distribution {
  name: string;
  params: CompiledExpr[];
  // Not implemented until Phase 1 (ARCHITECTURE.md §17) — see distributions.ts.
  sample(paramValues: number[], rng: RNG): number;
  mean?(paramValues: number[]): number;
}

export interface Node {
  id: NodeId;
  visibility: Visibility;
  kind: NodeKind;
  expr?: CompiledExpr;
  dist?: Distribution;
  noiseSD?: number;
  parents: NodeId[];
}

export interface Model {
  nodes: Map<NodeId, Node>;
  noise: Map<string, { id: string; dist: Distribution }>;
  topoOrder: NodeId[];
  observed(): NodeId[];
  parentsOf(id: NodeId): NodeId[];
  childrenOf(id: NodeId): NodeId[];
}

export function buildModel(
  nodes: Map<NodeId, Node>,
  noise: Map<string, { id: string; dist: Distribution }>,
  topoOrder: NodeId[],
): Model {
  return {
    nodes,
    noise,
    topoOrder,
    observed() {
      return topoOrder.filter((id) => nodes.get(id)?.visibility === 'observed');
    },
    parentsOf(id) {
      return nodes.get(id)?.parents ?? [];
    },
    childrenOf(id) {
      const children: NodeId[] = [];
      for (const [childId, node] of nodes) {
        if (node.parents.includes(id)) children.push(childId);
      }
      return children;
    },
  };
}
