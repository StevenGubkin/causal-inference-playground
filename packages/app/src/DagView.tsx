import { useCallback, useEffect, useState } from 'react';
import { applyNodeChanges, Background, Controls, MarkerType, ReactFlow, type Edge, type Node as FlowNode, type NodeChange } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Model } from 'scm-dsl';
import { layeredLayout } from './layout';

const ROLE_COLORS = {
  treatment: '#3b5bdb',
  outcome: '#099268',
  adjusted: '#e8a33d',
  latent: '#94a3b8',
  other: '#475569',
};

interface DagViewProps {
  model: Model;
  treatment: string;
  outcome: string;
  adjustmentSet?: ReadonlySet<string>;
}

function styleFor(nodeId: string, isLatent: boolean, treatment: string, outcome: string, adjustmentSet: ReadonlySet<string> | undefined) {
  const isTreatment = nodeId === treatment;
  const isOutcome = nodeId === outcome;
  const isAdjusted = adjustmentSet?.has(nodeId) ?? false;
  const roleColor = isTreatment ? ROLE_COLORS.treatment : isOutcome ? ROLE_COLORS.outcome : isAdjusted ? ROLE_COLORS.adjusted : isLatent ? ROLE_COLORS.latent : ROLE_COLORS.other;
  return {
    border: isLatent ? `2px dashed ${roleColor}` : `2px solid ${roleColor}`,
    borderRadius: 8,
    padding: '6px 12px',
    background: isTreatment ? '#dbe4ff' : isOutcome ? '#d3f9d8' : isAdjusted ? '#fdf0d5' : isLatent ? '#f1f5f9' : '#ffffff',
    color: roleColor,
    fontFamily: 'ui-monospace, monospace',
    fontSize: 13,
    fontWeight: isTreatment || isOutcome ? 600 : 400,
  };
}

export function DagView({ model, treatment, outcome, adjustmentSet }: DagViewProps) {
  const [nodes, setNodes] = useState<FlowNode[]>([]);

  // Recompute on every relevant prop change (new model, or just a
  // treatment/outcome/adjustment change that needs restyling), but keep
  // whatever position the user already dragged a node to -- by id, not by
  // object identity, so it survives re-parses that don't rename nodes.
  // Only genuinely new node ids fall back to the auto layout.
  useEffect(() => {
    const positions = layeredLayout(model);
    const posById = new Map(positions.map((p) => [p.id, p]));

    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]));
      return [...model.nodes.values()].map((node) => {
        const existing = prevById.get(node.id);
        const pos = posById.get(node.id)!;
        return {
          id: node.id,
          position: existing ? existing.position : { x: pos.x, y: pos.y },
          data: { label: node.id },
          style: styleFor(node.id, node.visibility === 'latent', treatment, outcome, adjustmentSet),
        };
      });
    });
  }, [model, treatment, outcome, adjustmentSet]);

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    setNodes((current) => applyNodeChanges(changes, current));
  }, []);

  const edges: Edge[] = [...model.nodes.values()].flatMap((node) =>
    node.parents.map((parentId) => ({
      id: `${parentId}->${node.id}`,
      source: parentId,
      target: node.id,
      style: { stroke: '#64748b' },
      markerEnd: { type: MarkerType.ArrowClosed, color: '#64748b' },
    })),
  );

  return (
    <div>
      <div style={{ height: 320, border: '1px solid #e2e8f0', borderRadius: 8 }}>
        <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} fitView proOptions={{ hideAttribution: true }} nodesDraggable nodesConnectable={false}>
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11.5, color: '#475569', margin: '6px 2px 0' }}>
        <Legend color={ROLE_COLORS.treatment} label="treatment" />
        <Legend color={ROLE_COLORS.outcome} label="outcome" />
        <Legend color={ROLE_COLORS.adjusted} label="adjusted for" />
        <Legend color={ROLE_COLORS.latent} label="latent" />
        <Legend color={ROLE_COLORS.other} label="other" />
      </div>
    </div>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
      <span style={{ display: 'inline-block', width: 18, height: 3, borderRadius: 2, background: color }} />
      {label}
    </span>
  );
}
