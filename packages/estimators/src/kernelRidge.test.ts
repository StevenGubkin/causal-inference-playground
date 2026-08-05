import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG, forwardSample } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { kernelRidgeDoseResponse } from './kernelRidge.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Kernel ridge solves an n x n dense system, unlike gcomp's O(p^3) OLS --
// these tests use a much smaller n than the 20000-row gcomp/iv2sls golden
// tests (matching packages/app's own SAMPLE_SIZE=500) to stay fast.
const N = 500;

describe('golden test: kernel ridge adjusting for {C} recovers the true effect (~2.0)', () => {
  it('matches ARCHITECTURE.md §10a / README.md within tolerance', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/confounding.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, N, createRNG(123));
    const observed = sample.observed();

    const curve = kernelRidgeDoseResponse(observed, 'X', 'Y', ['C'], [0, 1], 2, 0.5);
    const slope = curve.ys[1]! - curve.ys[0]!;

    expect(slope).toBeCloseTo(2.0, 0);
  });
});

describe('bandwidth: RBF kernel ridge recovers a nonlinear E[Y|X]', () => {
  // Y = X^2 + eps, X ~ Normal(0,1): same nonlinear DGP as gcomp.test.ts's
  // polynomial-degree test, here checking a well-tuned bandwidth instead of
  // a well-tuned polynomial degree.
  it('a reasonable bandwidth tracks the curve at both grid points', () => {
    const result = parseModel('X ~ Normal(0, 1)\nY = X^2 + eps');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, N, createRNG(99));
    const observed = sample.observed();

    const curve = kernelRidgeDoseResponse(observed, 'X', 'Y', [], [0, 2], 1, 0.1);

    expect(curve.ys[0]!).toBeCloseTo(0, 0);
    expect(curve.ys[1]!).toBeCloseTo(4, 0);
  });

  it('an oversized bandwidth over-smooths toward a flat fit, raising RMSE vs. the true curve', () => {
    const result = parseModel('X ~ Normal(0, 1)\nY = X^2 + eps');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, N, createRNG(99));
    const observed = sample.observed();

    const grid = [-2, -1, 0, 1, 2];
    const trueYs = grid.map((x) => x * x);

    function rmse(ys: number[]): number {
      let sumSq = 0;
      for (let i = 0; i < ys.length; i++) sumSq += (ys[i]! - trueYs[i]!) ** 2;
      return Math.sqrt(sumSq / ys.length);
    }

    const reasonable = kernelRidgeDoseResponse(observed, 'X', 'Y', [], grid, 1, 0.1);
    const oversized = kernelRidgeDoseResponse(observed, 'X', 'Y', [], grid, 1000, 0.1);

    expect(rmse(reasonable.ys)).toBeLessThan(rmse(oversized.ys));
    // an oversized bandwidth makes the RBF kernel ~constant across all pairs,
    // so the fit collapses toward the unconditional mean of Y everywhere --
    // i.e. a visibly flat curve, not just "worse".
    const oversizedRange = Math.max(...oversized.ys) - Math.min(...oversized.ys);
    const reasonableRange = Math.max(...reasonable.ys) - Math.min(...reasonable.ys);
    expect(oversizedRange).toBeLessThan(reasonableRange);
  });
});
