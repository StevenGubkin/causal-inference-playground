// ARCHITECTURE.md §12 "Export": DAG as SVG. Deliberately a standalone,
// hand-rolled renderer rather than capturing the live React Flow DOM --
// React Flow nodes are positioned HTML divs, not native SVG shapes, so a
// DOM-to-image capture would embed raster/foreignObject content instead of
// clean, editable vector shapes. This reuses the exact same layout
// (layeredLayout) and role colors (DagView's ROLE_COLORS) as the live view,
// so the export matches what's on screen, just as real SVG.
import type { Model, NodeId } from 'scm-dsl';
import { ROLE_COLORS } from '../DagView.js';
import { layeredLayout } from '../layout.js';

const BOX_HEIGHT = 32;
const CHAR_WIDTH = 7.2; // rough advance width for ui-monospace @ 13px
const BOX_PAD_X = 16;
const MARGIN = 40;

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxFor(id: NodeId, x: number, y: number): Box {
  const w = Math.max(48, id.length * CHAR_WIDTH + BOX_PAD_X * 2);
  return { x, y, w, h: BOX_HEIGHT };
}

/** Where a ray from `box`'s center toward (tx, ty) exits the box's border --
 * so edges stop at the node's edge instead of being drawn through its
 * interior. */
function edgePoint(box: Box, tx: number, ty: number): { x: number; y: number } {
  const dx = tx - box.x;
  const dy = ty - box.y;
  if (dx === 0 && dy === 0) return { x: box.x, y: box.y };
  const tX = dx !== 0 ? box.w / 2 / Math.abs(dx) : Infinity;
  const tY = dy !== 0 ? box.h / 2 / Math.abs(dy) : Infinity;
  const t = Math.min(tX, tY);
  return { x: box.x + dx * t, y: box.y + dy * t };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function roleColor(nodeId: NodeId, isLatent: boolean, treatment: NodeId, outcome: NodeId, adjustmentSet: ReadonlySet<NodeId>): string {
  if (nodeId === treatment) return ROLE_COLORS.treatment;
  if (nodeId === outcome) return ROLE_COLORS.outcome;
  if (adjustmentSet.has(nodeId)) return ROLE_COLORS.adjusted;
  if (isLatent) return ROLE_COLORS.latent;
  return ROLE_COLORS.other;
}

export function modelToSvg(model: Model, treatment: NodeId, outcome: NodeId, adjustmentSet: ReadonlySet<NodeId> = new Set()): string {
  const positions = layeredLayout(model);
  const boxes = new Map<NodeId, Box>();
  for (const p of positions) boxes.set(p.id, boxFor(p.id, p.x, p.y));

  const maxX = Math.max(0, ...positions.map((p) => p.x));
  const maxY = Math.max(0, ...positions.map((p) => p.y));
  const width = maxX + MARGIN * 2 + 100;
  const height = maxY + MARGIN * 2 + 60;

  const edgeSvg = [...model.nodes.values()]
    .flatMap((node) =>
      node.parents.map((parentId) => {
        const from = boxes.get(parentId)!;
        const to = boxes.get(node.id)!;
        const start = edgePoint(from, to.x, to.y);
        const end = edgePoint(to, from.x, from.y);
        return `<line x1="${start.x + MARGIN}" y1="${start.y + MARGIN}" x2="${end.x + MARGIN}" y2="${end.y + MARGIN}" stroke="#64748b" stroke-width="1.5" marker-end="url(#arrow)" />`;
      }),
    )
    .join('\n  ');

  const nodeSvg = [...model.nodes.values()]
    .map((node) => {
      const box = boxes.get(node.id)!;
      const isLatent = node.visibility === 'latent';
      const color = roleColor(node.id, isLatent, treatment, outcome, adjustmentSet);
      const cx = box.x + MARGIN;
      const cy = box.y + MARGIN;
      const dash = isLatent ? ' stroke-dasharray="4,3"' : '';
      return [
        `<rect x="${cx - box.w / 2}" y="${cy - box.h / 2}" width="${box.w}" height="${box.h}" rx="8" fill="white" stroke="${color}" stroke-width="2"${dash} />`,
        `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="ui-monospace, monospace" font-size="13" fill="${color}">${escapeXml(node.id)}</text>`,
      ].join('\n  ');
    })
    .join('\n  ');

  const legendY = maxY + MARGIN * 2 + 20;
  const legendEntries: [string, string][] = [
    ['treatment', ROLE_COLORS.treatment],
    ['outcome', ROLE_COLORS.outcome],
    ['adjusted for', ROLE_COLORS.adjusted],
    ['latent', ROLE_COLORS.latent],
    ['other', ROLE_COLORS.other],
  ];
  let legendX = MARGIN;
  const legendSvg = legendEntries
    .map(([label, color]) => {
      const swatch = `<line x1="${legendX}" y1="${legendY}" x2="${legendX + 18}" y2="${legendY}" stroke="${color}" stroke-width="3" />`;
      const text = `<text x="${legendX + 24}" y="${legendY}" dominant-baseline="central" font-family="ui-sans-serif, system-ui" font-size="11.5" fill="#475569">${escapeXml(label)}</text>`;
      legendX += 24 + label.length * 6.5 + 24;
      return `${swatch}\n  ${text}`;
    })
    .join('\n  ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" fill="#64748b" />
    </marker>
  </defs>
  <rect x="0" y="0" width="${width}" height="${height}" fill="white" />
  ${edgeSvg}
  ${nodeSvg}
  ${legendSvg}
</svg>
`;
}
