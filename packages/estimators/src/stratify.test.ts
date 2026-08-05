import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG, doContrast, forwardSample } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { stratifyDoseResponse } from './stratify.js';
import { fitMultivariateOLS, gcompDoseResponse } from './gcomp.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden test: stratifying by {Z} recovers the within-stratum effect on simpson.scm (~-1.0)', () => {
  it('matches the oracle and the documented true within-stratum coefficient', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/simpson.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 20000, createRNG(7));
    const observed = sample.observed();

    const curve = stratifyDoseResponse(observed, 'X', 'Y', ['Z'], [0, 1]);
    const stratifySlope = curve.ys[1]! - curve.ys[0]!;

    expect(stratifySlope).toBeCloseTo(-1.0, 1);

    // The naive (pooled, unadjusted) association is attenuated toward zero
    // relative to the within-stratum truth -- not sign-flipped, contrary to
    // this model file's own comment about the marginal association
    // "reversing sign" (numerically inaccurate for these coefficients: the
    // analytic Cov(X,Y)/Var(X) here is -0.6, same sign as the true -1.0,
    // just attenuated). Assert what the simulation actually shows.
    const naiveFit = fitMultivariateOLS([observed.columns.get('X')!], observed.columns.get('Y')!);
    const naiveSlope = naiveFit.coefficients[0]!;
    expect(Math.abs(naiveSlope - -1.0)).toBeGreaterThan(Math.abs(stratifySlope - -1.0));
  });
});

describe('stratifyDoseResponse: empty adjustment set matches gcompDoseResponse exactly', () => {
  it('both reduce to the same fitMultivariateOLS/predictMultivariate call on no covariates', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/simpson.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 2000, createRNG(8));
    const observed = sample.observed();

    const grid = [0, 0.5, 1, 1.5, 2];
    const stratifyCurve = stratifyDoseResponse(observed, 'X', 'Y', [], grid, 1);
    const gcompCurve = gcompDoseResponse(observed, 'X', 'Y', [], grid, 1);

    for (let i = 0; i < grid.length; i++) {
      expect(stratifyCurve.ys[i]!).toBeCloseTo(gcompCurve.ys[i]!, 5);
    }
  });
});

describe('stratifyDoseResponse: cardinality guard', () => {
  it('throws "too many strata" when the adjustment set is a continuous covariate', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/confounding.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 500, createRNG(9));
    const observed = sample.observed();

    expect(() => stratifyDoseResponse(observed, 'X', 'Y', ['C'], [0, 1])).toThrow(/too many strata/);
  });
});

describe('stratifyDoseResponse: missing-column errors', () => {
  it('throws when the adjustment covariate is a latent node stripped from the observed sample', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/iv-late.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 500, createRNG(1));
    const observed = sample.observed();

    expect(() => stratifyDoseResponse(observed, 'D', 'Y', ['U'], [0, 1])).toThrow(/missing from observed sample/);
  });
});

describe('stratifyDoseResponse: an undersized stratum', () => {
  it('throws with stratum context when one stratum has too few rows for a within-stratum fit', () => {
    // 10 rows: 9 in the Z=0 stratum (plenty for a degree-1 fit), 1 in the
    // Z=1 stratum -- passes the outer "too many strata" cardinality guard
    // (2 strata, minAvgStratumSize = 10/3), but the Z=1 stratum alone has
    // n=1 <= p=1, too few to fit its own within-stratum regression.
    const observed = {
      n: 10,
      columns: new Map([
        ['Z', Float64Array.from([0, 0, 0, 0, 0, 0, 0, 0, 0, 1])],
        ['X', Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])],
        ['Y', Float64Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9])],
      ]),
    };
    expect(() => stratifyDoseResponse(observed, 'X', 'Y', ['Z'], [0, 1])).toThrow(/too few rows to fit a within-stratum regression/);
  });
});

describe('stratify vs. the oracle', () => {
  it('agrees with the engine\'s own mutilated-graph simulation, not just a hand-computed number', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/simpson.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const sample = forwardSample(result.model, 20000, createRNG(7));
    const observed = sample.observed();

    const trueSlope = doContrast(result.model, 'X', 'Y', 0, 1, 20000, createRNG(70));
    const curve = stratifyDoseResponse(observed, 'X', 'Y', ['Z'], [0, 1]);
    const stratifySlope = curve.ys[1]! - curve.ys[0]!;

    expect(stratifySlope).toBeCloseTo(trueSlope, 0);
  });
});
