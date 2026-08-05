import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseModel } from './index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelsDir = join(__dirname, '../../examples/models');

function readModel(name: string): string {
  return readFileSync(join(modelsDir, name), 'utf8');
}

describe('gallery presets parse into a validated Model (Phase 0 deliverable)', () => {
  it('confounding.scm: C, X, Y all observed, no latents', () => {
    const result = parseModel(readModel('confounding.scm'));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(new Set(result.model.observed())).toEqual(new Set(['C', 'X', 'Y']));
    expect(result.model.parentsOf('Y').sort()).toEqual(['C', 'X']);
    expect(result.model.parentsOf('X')).toEqual(['C']);
  });

  it('collider.scm: S is a collider on independent X, Y', () => {
    const result = parseModel(readModel('collider.scm'));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(new Set(result.model.observed())).toEqual(new Set(['X', 'Y', 'S']));
    expect(result.model.parentsOf('S').sort()).toEqual(['X', 'Y']);
  });

  it('mediator.scm: effect of X on Y routes entirely through M', () => {
    const result = parseModel(readModel('mediator.scm'));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.model.parentsOf('M')).toEqual(['X']);
    expect(result.model.parentsOf('Y')).toEqual(['M']);
  });

  it('simpson.scm: Z confounds X and Y', () => {
    const result = parseModel(readModel('simpson.scm'));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.model.parentsOf('X')).toEqual(['Z']);
    expect(result.model.parentsOf('Y').sort()).toEqual(['X', 'Z']);
  });

  it('iv-late.scm: the one latent model — D_0/D_extra/D_1/U are latent, Z/D/Y observed', () => {
    const result = parseModel(readModel('iv-late.scm'));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const latentIds = [...result.model.nodes.values()].filter((n) => n.visibility === 'latent').map((n) => n.id);
    expect(new Set(latentIds)).toEqual(new Set(['U', 'D_0', 'D_extra', 'D_1']));
    expect(new Set(result.model.observed())).toEqual(new Set(['Z', 'D', 'Y']));
    // monotonicity-by-construction: D_1 = max(D_0, D_extra)
    expect(result.model.parentsOf('D_1').sort()).toEqual(['D_0', 'D_extra']);
    // exclusion-by-construction: Z reaches Y only through D
    expect(result.model.parentsOf('Y')).not.toContain('Z');
    expect(result.model.parentsOf('D').sort()).toEqual(['D_0', 'D_1', 'Z']);
  });
});

describe('§4.8 static validation rules', () => {
  it('rule 1/6: rejects an unresolved identifier', () => {
    const result = parseModel('X = Y + eps');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('unresolved identifier "Y"'))).toBe(true);
  });

  it('rule 6: rejects property-access syntax (sandbox-escape shape)', () => {
    const result = parseModel('X ~ Normal(0, 1)\nY = X.constructor');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('disallowed syntax'))).toBe(true);
  });

  it('rule 6: rejects a disallowed function (e.g. import)', () => {
    const result = parseModel('X = import("evil")');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('disallowed function'))).toBe(true);
  });

  it('rule 3: rejects a cycle and names the path', () => {
    const result = parseModel('A = B + eps\nB = A + eps');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('cycle detected'))).toBe(true);
  });

  it('rule 4: rejects unknown distributions', () => {
    const result = parseModel('X ~ Foo(1)\nY = X + eps');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('unknown distribution "Foo"'))).toBe(true);
  });

  it('rule 4: rejects wrong arity', () => {
    const result = parseModel('X ~ Normal(0)\nY = X + eps');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('expects exactly 2 arguments'))).toBe(true);
  });

  it('rule 4: rejects a non-positive constant sd', () => {
    const result = parseModel('X ~ Normal(0, -1)\nY = X + eps');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('sd (2nd argument) must be > 0'))).toBe(true);
  });

  it('rule 4: does not flag a parent-dependent (non-constant) param', () => {
    // sd depends on a parent -> deferred to runtime, not a parse-time error.
    const result = parseModel('Z ~ Normal(0, 1)\nX ~ Normal(0, abs(Z) + 1)');
    expect(result.ok).toBe(true);
  });

  it('rule 5: rejects a model with no observed treatment/outcome pair', () => {
    const result = parseModel('X ~ Normal(0, 1)');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('no valid treatment/outcome pair'))).toBe(true);
  });

  it('<->: wires a fresh independent latent parent', () => {
    const result = parseModel('X ~ Normal(0, 1)\nY = X + eps\nX <-> Y');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.model.parentsOf('X')).toContain('U_X_Y');
    expect(result.model.parentsOf('Y')).toContain('U_X_Y');
  });

  it('rejects duplicate declarations', () => {
    const result = parseModel('X ~ Normal(0, 1)\nX = 1 + eps\nY = X + eps');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes('declared more than once'))).toBe(true);
  });
});

describe('Distribution.sample() is a Phase 1 stub', () => {
  it('throws with a clear message rather than silently returning a number', () => {
    const result = parseModel(readModel('confounding.scm'));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const dist = result.model.nodes.get('C')?.dist;
    expect(dist).toBeDefined();
    expect(() => dist!.sample([0, 1], {} as never)).toThrow(/Phase 1/);
  });
});
