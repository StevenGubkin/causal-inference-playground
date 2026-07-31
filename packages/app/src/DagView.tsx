import { Background, Controls, ReactFlow, type Edge, type Node as FlowNode } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Model } from 'scm-dsl';
import { layeredLayout } from './layout';

interface DagViewProps {
  model: Model;
  treatment: string;
  outcome: string;
}

export function DagView({ model, treatment, outcome }: DagViewProps) {
  const positions = layeredLayout(model);
  const posById = new Map(positions.map((p) => [p.id, p]));

  const nodes: FlowNode[] = [...model.nodes.values()].map((node) => {
    const pos = posById.get(node.id)!;
    const isTreatment = node.id === treatment;
    const isOutcome = node.id === outcome;
    const isLatent = node.visibility === 'latent';
    return {
      id: node.id,
      position: { x: pos.x, y: pos.y },
      data: { label: node.id },
      style: {
        border: isLatent ? '2px dashed #94a3b8' : isTreatment || isOutcome ? '2px solid #1e293b' : '1.5px solid #475569',
        borderRadius: 8,
        padding: '6px 12px',
        background: isTreatment ? '#bfdbfe' : isOutcome ? '#bbf7d0' : isLatent ? '#f1f5f9' : '#ffffff',
        fontFamily: 'ui-monospace, monospace',
        fontSize: 13,
        fontWeight: isTreatment || isOutcome ? 600 : 400,
      },
    };
  });

  const edges: Edge[] = [...model.nodes.values()].flatMap((node) =>
    node.parents.map((parentId) => ({
      id: `${parentId}->${node.id}`,
      source: parentId,
      target: node.id,
      style: { stroke: '#64748b' },
    })),
  );

  return (
    <div style={{ height: 320, border: '1px solid #e2e8f0', borderRadius: 8 }}>
      <ReactFlow nodes={nodes} edges={edges} fitView proOptions={{ hideAttribution: true }} nodesDraggable={false} nodesConnectable={false}>
        <Background />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
