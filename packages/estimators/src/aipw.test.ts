import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG, doContrast, doResponse, forwardSample } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { aipwAte } from './aipw.js';
import { ipwAte } from './ipw.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadIpwConfoundingSample(n: number, seed: number) {
  const source = readFileSync(join(__dirname, '../../examples/models/ipw-confounding.scm'), 'utf8');
  const result = parseModel(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  const sample = forwardSample(result.model, n, createRNG(seed));
  return { model: result.model, observed: sample.observed() };
}

describe('golden test: AIPW recovers the true ATE on ipw-confounding.scm (~2.0)', () => {
  it('matches the documented true effect within tolerance, both nuisance models correct', () => {
    const { observed } = loadIpwConfoundingSample(20000, 123);
    const result = aipwAte(observed, 'X', 'Y', ['Z'], [0, 1]);
    expect(result.estimate).toBeCloseTo(2.0, 1);
  });

  it('agrees with the engine\'s own mutilated-graph oracle', () => {
    const { model, observed } = loadIpwConfoundingSample(20000, 123);
    const trueAte = doContrast(model, 'X', 'Y', 0, 1, 20000, createRNG(124));
    const result = aipwAte(observed, 'X', 'Y', ['Z'], [0, 1]);
    expect(result.estimate).toBeCloseTo(trueAte, 0);
  });
});

describe('regression: the plotted curve (.ys), not just .estimate, must match truth', () => {
  // Guards against a real bug that shipped once: sumTau (-> .estimate) had
  // the correct sign, but sumMu0 (-> .ys' baseline) reused sumTau's sign
  // convention for the control-arm augmentation instead of its own --
  // invisible under a correctly-specified outcome model (residuals average
  // out either way), but a large, clearly-wrong baseline under a
  // misspecified one. Checking only `.estimate` (as the golden tests above
  // do) can't catch this; the curve itself has to be asserted.
  it('.ys[0]/.ys[1] track the oracle E[Y|do(X=0)]/E[Y|do(X=1)], outcome model correctly specified', () => {
    const { model, observed } = loadIpwConfoundingSample(20000, 123);
    const trueCurve = doResponse(model, 'X', 'Y', [0, 1], 20000, createRNG(124));
    const result = aipwAte(observed, 'X', 'Y', ['Z'], [0, 1]);
    expect(result.ys[0]).toBeCloseTo(trueCurve.ys[0]!, 0);
    expect(result.ys[1]).toBeCloseTo(trueCurve.ys[1]!, 0);
  });

  it('.ys[0] still tracks truth when the outcome model is deliberately misspecified (propensity correct)', () => {
    const { model, observed } = loadIpwConfoundingSample(50000, 123);
    const trueCurve = doResponse(model, 'X', 'Y', [0, 1], 20000, createRNG(124));
    // outcomeSet=[] -- an intercept-and-treatment-only outcome model, the
    // exact scenario that exposed the sign bug (buggy baseline came out
    // ~-1.40 against a true value of ~0, vs. ~-0.02 correctly signed).
    const result = aipwAte(observed, 'X', 'Y', ['Z'], [0, 1], ['Z'], []);
    expect(result.ys[0]).toBeCloseTo(trueCurve.ys[0]!, 0);
  });
});

describe('doubly robust: consistent when only one nuisance model is correctly specified', () => {
  it('tolerates a misspecified (intercept-only) propensity model when the outcome model is correct', () => {
    const { observed } = loadIpwConfoundingSample(20000, 123);
    // propensitySet=[] forces an uninformative, intercept-only propensity
    // model; outcomeSet defaults to ['Z'], the correct adjustment set.
    const aipwMisspec = aipwAte(observed, 'X', 'Y', ['Z'], [0, 1], []);
    expect(aipwMisspec.estimate).toBeCloseTo(2.0, 1);

    // A *plain* IPW estimator given the same uninformative (empty)
    // adjustment set has no outcome-model fallback to lean on, so it should
    // be demonstrably further from the truth than AIPW's augmented estimate --
    // the actual "augmentation forgives one wrong model" property.
    const plainIpwNoAdjust = ipwAte(observed, 'X', 'Y', [], [0, 1]);
    expect(Math.abs(aipwMisspec.estimate - 2.0)).toBeLessThan(Math.abs(plainIpwNoAdjust.estimate - 2.0));
  });

  it('tolerates a misspecified (intercept-only) outcome model when the propensity model is correct', () => {
    const { observed } = loadIpwConfoundingSample(20000, 123);
    // propensitySet defaults to ['Z'] via the third positional arg; outcomeSet=[]
    // forces an intercept-and-treatment-only outcome model with no covariate.
    const aipwMisspec = aipwAte(observed, 'X', 'Y', ['Z'], [0, 1], ['Z'], []);
    expect(aipwMisspec.estimate).toBeCloseTo(2.0, 1);
  });
});

describe('aipwAte: requires a binary treatment', () => {
  it('throws when the treatment column is continuous', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/confounding.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 500, createRNG(1));
    const observed = sample.observed();

    expect(() => aipwAte(observed, 'X', 'Y', ['C'], [0, 1])).toThrow(/binary/);
  });
});

describe('aipwAte: missing-column errors', () => {
  it('throws when an adjustment covariate is not in the observed sample', () => {
    const { observed } = loadIpwConfoundingSample(500, 1);
    expect(() => aipwAte(observed, 'X', 'Y', ['not_a_column'], [0, 1])).toThrow(/missing from observed sample/);
  });
});
