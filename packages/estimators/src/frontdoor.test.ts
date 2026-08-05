import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG, forwardSample } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { frontdoorDoseResponse } from './frontdoor.js';
import { fitMultivariateOLS } from './gcomp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden test: front-door via {M} recovers the true effect (~6.0)', () => {
  it('matches ARCHITECTURE.md §10a / README.md within tolerance', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/frontdoor.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 20000, createRNG(321));
    const observed = sample.observed();

    const curve = frontdoorDoseResponse(observed, 'X', 'Y', 'M', [0, 1]);
    const slope = curve.ys[1]! - curve.ys[0]!;

    expect(slope).toBeCloseTo(6.0, 0);
    expect(curve.estimate).toBeCloseTo(6.0, 0);
  });

  it('naive OLS on the same sample is badly biased -- this is why front-door is needed', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/frontdoor.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 20000, createRNG(321));
    const observed = sample.observed();

    const fit = fitMultivariateOLS([observed.columns.get('X')!], observed.columns.get('Y')!);
    expect(Math.abs(fit.coefficients[0]! - 6.0)).toBeGreaterThan(1.0);
  });
});

describe('front-door reduces to plain path-chaining with no confounding', () => {
  it('recovers ~2.0 on mediator.scm (X->M->Y, no U)', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/mediator.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 20000, createRNG(322));
    const observed = sample.observed();

    const curve = frontdoorDoseResponse(observed, 'X', 'Y', 'M', [0, 1]);
    const slope = curve.ys[1]! - curve.ys[0]!;

    expect(slope).toBeCloseTo(2.0, 0);
  });
});

describe('frontdoorDoseResponse: missing-column errors', () => {
  it('throws when the mediator is a latent node stripped from the observed sample', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/frontdoor.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 500, createRNG(1));
    const observed = sample.observed();

    // U is latent (the model's own confounder) -- a plausible mistake if a
    // caller passes the wrong node id, e.g. confusing "the confounder" with
    // "the mediator".
    expect(() => frontdoorDoseResponse(observed, 'X', 'Y', 'U', [0, 1])).toThrow(/missing from observed sample/);
  });
});

describe('frontdoorDoseResponse: too few observations', () => {
  it('throws rather than silently fitting garbage when n is too small for the two-stage regression', () => {
    // Stage 2 fits [intercept, mediator, treatment] -- 3 parameters -- so
    // n=2 has too few observations even though stage 1 (2 parameters) alone
    // would be fine. This is realistic: a user could resample down to a
    // tiny n via a very restrictive freeform model.
    const observed = {
      n: 2,
      columns: new Map([
        ['X', Float64Array.from([0, 1])],
        ['M', Float64Array.from([0, 2])],
        ['Y', Float64Array.from([0, 3])],
      ]),
    };
    expect(() => frontdoorDoseResponse(observed, 'X', 'Y', 'M', [0, 1])).toThrow(/need more observations/);
  });
});

describe('known limitation: a mediator with no residual variance given X', () => {
  it('does not crash, but the estimate is unreliable when M is an exact deterministic function of X', () => {
    // M = 2*X with no +eps term is valid DSL (equations without eps are
    // simply deterministic) and reachable via the live UI by writing a
    // mediator equation with no noise term, or setting noise sigma to 0.
    // Stage 2's design matrix [1, M, X] is then exactly rank-deficient (M
    // and X are perfectly collinear) -- fitMultivariateOLS has no
    // collinearity guard, so mathjs's lusolve silently returns *some*
    // solution to the singular normal equations rather than throwing. The
    // fitted split between the M-coefficient and the X-coefficient is then
    // numerically arbitrary, even though nothing crashes or produces NaN.
    const parsed = parseModel('latent U ~ Normal(0, 1)\nX = 2*U + eps\nM = 2*X\nY = 3*M + 5*U + eps');
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    const sample = forwardSample(parsed.model, 500, createRNG(42));
    const observed = sample.observed();

    const result = frontdoorDoseResponse(observed, 'X', 'Y', 'M', [0, 1]);

    expect(Number.isFinite(result.estimate)).toBe(true);
    // Unlike the golden test's well-posed (noisy-mediator) case, this
    // estimate is not reliably close to the true effect of 6.0 -- pinning
    // that down here documents the gap rather than letting it go unnoticed.
    expect(Math.abs(result.estimate - 6.0)).toBeGreaterThan(0.5);
  });
});
