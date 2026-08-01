import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG, forwardSample } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { gcompDoseResponse } from './gcomp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden test 1: g-computation adjusting for {C} recovers the true effect (~2.01)', () => {
  it('matches ARCHITECTURE.md §10a / README.md within tolerance', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/confounding.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 20000, createRNG(123));
    const observed = sample.observed();

    const curve = gcompDoseResponse(observed, 'X', 'Y', ['C'], [0, 1]);
    const slope = curve.ys[1]! - curve.ys[0]!;

    expect(slope).toBeCloseTo(2.0, 1);
  });

  it('adjusting for the collider (a bad adjustment set) increases bias rather than fixing it', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/collider.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 20000, createRNG(7));
    const observed = sample.observed();

    // X and Y are independent by construction (true effect 0); adjusting
    // for their collider S should visibly move the estimate away from 0.
    const curve = gcompDoseResponse(observed, 'X', 'Y', ['S'], [0, 1]);
    const biasedSlope = curve.ys[1]! - curve.ys[0]!;

    expect(Math.abs(biasedSlope)).toBeGreaterThan(0.2);
  });
});

describe('treatmentDegree: polynomial basis recovers a nonlinear E[Y|X]', () => {
  // Y = X^2 + eps, X ~ Normal(0,1): a pure quadratic functional relationship
  // (no confounding). Since X is symmetric about 0, Cov(X, X^2) = 0, so a
  // degree-1 fit is forced flat near E[X^2] = 1 and completely misses the
  // curve; degree-2 should recover x^2 closely.
  it('degree 1 misses the curve; degree 2 recovers it', () => {
    const result = parseModel('X ~ Normal(0, 1)\nY = X^2 + eps');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 20000, createRNG(99));
    const observed = sample.observed();

    const degree1 = gcompDoseResponse(observed, 'X', 'Y', [], [0, 2], 1);
    const degree2 = gcompDoseResponse(observed, 'X', 'Y', [], [0, 2], 2);

    // degree-1 prediction at x=2 stays far below the true value of 4
    expect(degree1.ys[1]!).toBeLessThan(2);
    // degree-2 recovers x^2 closely at both grid points
    expect(degree2.ys[0]!).toBeCloseTo(0, 0);
    expect(degree2.ys[1]!).toBeCloseTo(4, 0);
  });
});
