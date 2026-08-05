import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG, forwardSample } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { fitLogisticRegression } from './logistic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden test: fitLogisticRegression recovers the true logit coefficients', () => {
  it('recovers intercept ~0, slope ~0.5 on ipw-confounding.scm (X ~ Bernoulli(logistic(0.5*Z)))', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/ipw-confounding.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 20000, createRNG(123));
    const observed = sample.observed();

    const fit = fitLogisticRegression([observed.columns.get('Z')!], observed.columns.get('X')!);

    expect(fit.intercept).toBeCloseTo(0, 0);
    expect(fit.coefficients[0]!).toBeCloseTo(0.5, 1);
  });
});

describe('fitLogisticRegression: too few observations', () => {
  it('throws when n <= p', () => {
    const predictorColumns = [Float64Array.from([0, 1]), Float64Array.from([1, 0])];
    const y = Float64Array.from([0, 1]);
    expect(() => fitLogisticRegression(predictorColumns, y)).toThrow(/need more observations/);
  });
});

describe('fitLogisticRegression: an unrelated predictor recovers a near-zero coefficient', () => {
  it('does not manufacture a relationship that does not exist', () => {
    const result = parseModel('Z ~ Normal(0, 1)\nX ~ Bernoulli(0.5)\nY = Z + eps');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 5000, createRNG(555));
    const observed = sample.observed();

    const fit = fitLogisticRegression([observed.columns.get('Z')!], observed.columns.get('X')!);
    expect(Math.abs(fit.coefficients[0]!)).toBeLessThan(0.3);
  });
});
