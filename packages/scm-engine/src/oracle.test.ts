import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { doContrast, doResponse, lateContrast } from './oracle.js';
import { createRNG } from './rng.js';
import { forwardSample } from './sample.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadModel(name: string) {
  const source = readFileSync(join(__dirname, '../../examples/models', name), 'utf8');
  const result = parseModel(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.model;
}

describe('forwardSample', () => {
  it('produces one column per node, of length n, and strips latents from observed()', () => {
    const model = loadModel('iv-late.scm');
    const sample = forwardSample(model, 50, createRNG(1));
    expect(sample.n).toBe(50);
    expect(sample.columns.get('Z')?.length).toBe(50);
    expect(sample.columns.has('U')).toBe(true); // full sample keeps latents

    const observed = sample.observed();
    expect(new Set(observed.columns.keys())).toEqual(new Set(['Z', 'D', 'Y']));
  });
});

describe('golden test 1: intervention by mutilation (ARCHITECTURE.md §10a)', () => {
  // C~N(0,1); X=1.5C+eps; Y=2X+3C+eps -- true effect of X on Y is exactly 2.0.
  const model = loadModel('confounding.scm');

  it('oracle.doContrast recovers the true effect (~2.00), not the confounded naive slope (~3.38)', () => {
    const effect = doContrast(model, 'X', 'Y', 0, 1, 4000, createRNG(42));
    expect(effect).toBeCloseTo(2.0, 1);
  });

  it('common random numbers make the do-response curve exactly linear (no jitter)', () => {
    const curve = doResponse(model, 'X', 'Y', [0, 1, 2], 4000, createRNG(7));
    const secondDifference = curve.ys[2]! - 2 * curve.ys[1]! + curve.ys[0]!;
    expect(Math.abs(secondDifference)).toBeLessThan(0.05);
  });
});

describe('lateContrast: the true LATE differs from the population ATE under compliance heterogeneity', () => {
  // iv-late.scm: Y = (1*D_0*D_1 + 3*(1-D_0)*D_1)*D + 1.5*U + eps -- always-takers
  // get effect 1, compliers get effect 3. doContrast (population ATE) mixes
  // both by population share; lateContrast should isolate the compliers'
  // effect of exactly 3, distinct from the population figure.
  const model = loadModel('iv-late.scm');

  it('recovers the compliers-only effect (~3.0), not the population ATE (~1.4)', () => {
    const late = lateContrast(model, 'D', 'Y', 'Z', 4000, createRNG(11));
    expect(late.estimate).toBeCloseTo(3.0, 0);
    expect(late.complierShare).toBeGreaterThan(0);
    expect(late.complierShare).toBeLessThan(1);

    const ate = doContrast(model, 'D', 'Y', 0, 1, 4000, createRNG(11));
    expect(Math.abs(late.estimate - ate)).toBeGreaterThan(1.0);
  });
});
