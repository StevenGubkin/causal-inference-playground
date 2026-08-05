import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModel } from 'scm-dsl';
import type { Model } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { frontdoorValid } from './frontdoor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadModel(name: string): Model {
  const source = readFileSync(join(__dirname, '../../examples/models', name), 'utf8');
  const result = parseModel(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.model;
}

function parseInline(source: string): Model {
  const result = parseModel(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.model;
}

describe('frontdoorValid: frontdoor.scm', () => {
  it('{M} is a valid front-door set', () => {
    const model = loadModel('frontdoor.scm');
    expect(frontdoorValid(model, 'X', 'Y', new Set(['M'])).ok).toBe(true);
  });
});

describe('frontdoorValid: rejects an empty mediator set', () => {
  it('{} is invalid regardless of the graph', () => {
    const model = loadModel('frontdoor.scm');
    const result = frontdoorValid(model, 'X', 'Y', new Set());
    expect(result.ok).toBe(false);
  });
});

describe('frontdoorValid: condition (a) -- M must intercept every directed path', () => {
  it('is invalid when a direct X->Y edge bypasses the mediator', () => {
    // Same skeleton as frontdoor.scm, plus a direct X->Y edge.
    const model = parseInline('latent U ~ Normal(0, 1)\nX = U + eps\nM = 2*X + eps\nY = 3*M + U + X + eps');
    const result = frontdoorValid(model, 'X', 'Y', new Set(['M']));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('bypasses');
  });
});

describe('frontdoorValid: condition (b) -- no unblocked backdoor path into M', () => {
  it('is invalid when a confounder opens a backdoor path between X and M', () => {
    // W confounds both X and M directly (not through X), so cutting X's
    // outgoing edge doesn't close the X<-W->M path.
    const model = parseInline('latent U ~ Normal(0, 1)\nlatent W ~ Normal(0, 1)\nX = U + W + eps\nM = 2*X + W + eps\nY = 3*M + U + eps');
    const result = frontdoorValid(model, 'X', 'Y', new Set(['M']));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('backdoor path remains between "X"');
  });
});

describe('frontdoorValid: condition (c) -- X must block every backdoor path from M to Y', () => {
  it('is invalid when a second confounder links M and Y without going through X', () => {
    // V confounds M and Y directly, so conditioning on X alone doesn't
    // block the M<-V->Y path.
    const model = parseInline('latent U ~ Normal(0, 1)\nlatent V ~ Normal(0, 1)\nX = U + eps\nM = 2*X + V + eps\nY = 3*M + U + V + eps');
    const result = frontdoorValid(model, 'X', 'Y', new Set(['M']));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('backdoor path remains between mediator');
  });
});

describe('frontdoorValid: multi-node mediator sets', () => {
  // Two parallel mediating paths, X->M1->Y and X->M2->Y, neither confounded.
  const model = parseInline('X ~ Normal(0, 1)\nM1 = X + eps\nM2 = X + eps\nY = M1 + M2 + eps');

  it('a partial mediator set is invalid -- the other path bypasses it', () => {
    const result = frontdoorValid(model, 'X', 'Y', new Set(['M1']));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('bypasses');
  });

  it('the full mediator set {M1, M2} is valid -- together they intercept every path', () => {
    expect(frontdoorValid(model, 'X', 'Y', new Set(['M1', 'M2'])).ok).toBe(true);
  });
});

describe('frontdoorValid: condition (a) catches a multi-hop bypass, not just a direct edge', () => {
  it('is invalid when an unmediated two-hop path (X->Z->Y) bypasses the mediator', () => {
    // Z is a second, independent path from X to Y that never passes
    // through M -- unlike the existing condition-(a) test (a single direct
    // X->Y edge), this exercises the general reachability-avoiding-M logic
    // against a longer bypass path.
    const model = parseInline('X ~ Normal(0, 1)\nM = X + eps\nZ = X + eps\nY = M + Z + eps');
    const result = frontdoorValid(model, 'X', 'Y', new Set(['M']));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('bypasses');
  });
});

describe('frontdoorValid: degenerate self-referential mediator sets', () => {
  // No confounding at all here, deliberately -- on frontdoor.scm, U's
  // confounding would make condition (b) fail for an unrelated reason,
  // masking whether the self-reference itself is actually being caught.
  const model = parseInline('X ~ Normal(0, 1)\nM = X + eps\nY = M + eps');

  it('the mediator cannot be the treatment itself', () => {
    // Caught by condition (b): backdoorValid(X, X, {}) is never true, since
    // a node is never d-separated from itself.
    expect(frontdoorValid(model, 'X', 'Y', new Set(['X'])).ok).toBe(false);
  });

  it('the mediator cannot be the outcome itself', () => {
    // Conditions (a) and (b) both vacuously pass here (a path can't be
    // "avoiding Y" while ending at Y, and X/Y are unconfounded) -- only
    // condition (c)'s self-referential backdoorValid(Y, Y, {X}) call
    // catches this, the same way condition (b) catches the treatment case.
    expect(frontdoorValid(model, 'X', 'Y', new Set(['Y'])).ok).toBe(false);
  });
});
