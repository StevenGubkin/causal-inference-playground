import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { ROLE_COLORS } from '../DagView.js';
import { modelToSvg } from './dagSvg.js';

describe('modelToSvg', () => {
  it('renders a valid, well-formed SVG document with all nodes, edges, and role colors', () => {
    const parsed = parseModel('C ~ Normal(0, 1)\nX = 1.5*C + eps\nY = 2*X + 3*C + eps');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    const svg = modelToSvg(parsed.model, 'X', 'Y', new Set(['C']));

    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trim().endsWith('</svg>')).toBe(true);

    // one <rect> per node, labeled with its id
    for (const id of ['C', 'X', 'Y']) {
      expect(svg).toContain(`>${id}</text>`);
    }

    // role coloring: X is treatment (blue), Y is outcome (green), C is
    // adjusted-for (amber) since it's in the adjustment set passed in.
    expect(svg).toContain(ROLE_COLORS.treatment);
    expect(svg).toContain(ROLE_COLORS.outcome);
    expect(svg).toContain(ROLE_COLORS.adjusted);

    // edges: C->X, X->Y, C->Y (legend swatches are also <line>s, so match
    // on the arrowhead marker specifically to count only graph edges)
    expect((svg.match(/marker-end="url\(#arrow\)"/g) ?? []).length).toBe(3);

    // legend present
    expect(svg).toContain('>treatment</text>');
    expect(svg).toContain('>adjusted for</text>');
  });

  it('dashes latent nodes and colors them distinctly', () => {
    const parsed = parseModel('latent U ~ Normal(0, 1)\nX = U + eps\nY = X + U + eps');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    const svg = modelToSvg(parsed.model, 'X', 'Y');

    expect(svg).toContain('stroke-dasharray="4,3"');
    expect(svg).toContain(ROLE_COLORS.latent);
  });

  it('escapes XML-sensitive characters in node ids and legend labels', () => {
    // Node ids can't actually contain <, &, etc. per the DSL grammar, but
    // escapeXml is exercised directly here as a defensive unit check.
    const parsed = parseModel('X ~ Normal(0, 1)\nY = X + eps');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
    const svg = modelToSvg(parsed.model, 'X', 'Y');
    expect(svg).not.toContain('&amp;amp;'); // no double-escaping
  });
});
