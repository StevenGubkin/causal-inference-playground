import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG, forwardSample } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { fitSimpleLinearRegression } from './ols.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden test 1: naive OLS reproduces the documented confounded slope (~3.38)', () => {
  it('matches ARCHITECTURE.md §10a within tolerance', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/confounding.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 20000, createRNG(123));
    const observed = sample.observed();
    const fit = fitSimpleLinearRegression(observed.columns.get('X')!, observed.columns.get('Y')!);

    expect(fit.slope).toBeCloseTo(3.38, 0);
  });
});
