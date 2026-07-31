import type { Model, NodeId } from 'scm-dsl';

export interface LayoutNode {
  id: NodeId;
  x: number;
  y: number;
}

/**
 * Minimal layered layout: depth = longest path from a root, position within
 * a layer by topoOrder appearance. Good enough for the small gallery
 * models; dagre/elkjs (ARCHITECTURE.md §3) can replace this later.
 */
export function layeredLayout(model: Model, xSpacing = 190, ySpacing = 90): LayoutNode[] {
  const depth = new Map<NodeId, number>();
  for (const id of model.topoOrder) {
    const parents = model.parentsOf(id);
    const d = parents.length === 0 ? 0 : Math.max(...parents.map((p) => depth.get(p) ?? 0)) + 1;
    depth.set(id, d);
  }

  const countByDepth = new Map<number, number>();
  return model.topoOrder.map((id) => {
    const d = depth.get(id)!;
    const row = countByDepth.get(d) ?? 0;
    countByDepth.set(d, row + 1);
    return { id, x: d * xSpacing, y: row * ySpacing };
  });
}
