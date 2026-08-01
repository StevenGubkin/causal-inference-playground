// ARCHITECTURE.md §9 — topoLayers: group nodes by parent-depth. A
// graph-algorithms-package function operating on the compiled Model; not
// unified with packages/app/src/layout.ts, which solves a different problem
// (pixel positions for React Flow rendering) and would be an unnecessary
// coupling of a UI concern into this package.
import type { Model, NodeId } from 'scm-dsl';

export function topoLayers(model: Model): NodeId[][] {
  const depth = new Map<NodeId, number>();
  for (const id of model.topoOrder) {
    const parents = model.parentsOf(id);
    const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => depth.get(p) ?? 0)) + 1;
    depth.set(id, d);
  }

  const maxDepth = Math.max(0, ...depth.values());
  const layers: NodeId[][] = Array.from({ length: maxDepth + 1 }, () => []);
  for (const id of model.topoOrder) layers[depth.get(id)!]!.push(id);
  return layers;
}
