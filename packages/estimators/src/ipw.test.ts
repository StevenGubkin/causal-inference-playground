import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG, doContrast, forwardSample } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { ipwAte } from './ipw.js';
import { fitMultivariateOLS } from './gcomp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadIpwConfoundingSample(n: number, seed: number) {
  const source = readFileSync(join(__dirname, '../../examples/models/ipw-confounding.scm'), 'utf8');
  const result = parseModel(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const sample = forwardSample(result.model, n, createRNG(seed));
  return { model: result.model, observed: sample.observed() };
}

describe('golden test: IPW recovers the true ATE on ipw-confounding.scm (~2.0)', () => {
  it('matches the documented true effect within tolerance', () => {
    const { observed } = loadIpwConfoundingSample(20000, 123);
    const result = ipwAte(observed, 'X', 'Y', ['Z'], [0, 1]);
    expect(result.estimate).toBeCloseTo(2.0, 1);
  });

  it('agrees with the engine\'s own mutilated-graph oracle', () => {
    const { model, observed } = loadIpwConfoundingSample(20000, 123);
    const trueAte = doContrast(model, 'X', 'Y', 0, 1, 20000, createRNG(124));
    const result = ipwAte(observed, 'X', 'Y', ['Z'], [0, 1]);
    expect(result.estimate).toBeCloseTo(trueAte, 0);
  });

  it('naive OLS on the same sample is badly biased -- this is why IPW is needed', () => {
    const { observed } = loadIpwConfoundingSample(20000, 123);
    const naiveFit = fitMultivariateOLS([observed.columns.get('X')!], observed.columns.get('Y')!);
    expect(Math.abs(naiveFit.coefficients[0]! - 2.0)).toBeGreaterThan(1.0);
  });
});

describe('ipwAte: overlap diagnostics', () => {
  it('reports a min overlap in (0,1) and effective sample sizes within their arm bounds', () => {
    const { observed } = loadIpwConfoundingSample(20000, 123);
    const result = ipwAte(observed, 'X', 'Y', ['Z'], [0, 1]);

    expect(result.minOverlap).toBeGreaterThan(0);
    expect(result.minOverlap).toBeLessThan(1);

    const treatedCount = Array.from(observed.columns.get('X')!).filter((v) => v === 1).length;
    const controlCount = observed.n - treatedCount;
    expect(result.effectiveSampleSizeTreated).toBeGreaterThan(0);
    expect(result.effectiveSampleSizeTreated).toBeLessThanOrEqual(treatedCount);
    expect(result.effectiveSampleSizeControl).toBeGreaterThan(0);
    expect(result.effectiveSampleSizeControl).toBeLessThanOrEqual(controlCount);
  });
});

describe('ipwAte: requires a binary treatment', () => {
  it('throws when the treatment column is continuous', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/confounding.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 500, createRNG(1));
    const observed = sample.observed();

    expect(() => ipwAte(observed, 'X', 'Y', ['C'], [0, 1])).toThrow(/binary/);
  });
});

describe('ipwAte: missing-column errors', () => {
  it('throws when an adjustment covariate is not in the observed sample', () => {
    const { observed } = loadIpwConfoundingSample(500, 1);
    expect(() => ipwAte(observed, 'X', 'Y', ['not_a_column'], [0, 1])).toThrow(/missing from observed sample/);
  });
});

describe('ipwAte: too few observations', () => {
  it('throws (bubbled from fitLogisticRegression) when n <= the number of adjustment covariates', () => {
    const observed = {
      n: 2,
      columns: new Map([
        ['X', Float64Array.from([0, 1])],
        ['Z1', Float64Array.from([0, 1])],
        ['Z2', Float64Array.from([1, 0])],
        ['Y', Float64Array.from([0, 3])],
      ]),
    };
    expect(() => ipwAte(observed, 'X', 'Y', ['Z1', 'Z2'], [0, 1])).toThrow(/need more observations/);
  });
});
