// ARCHITECTURE.md §8 / METHODS.md §4: the `frontdoor` estimator. Chains two
// regressions -- stage 1 identifies X -> M (assumed clean, no confounding
// into M), stage 2 identifies M -> Y adjusting for X (which blocks the only
// backdoor path from M to Y, per the front-door assumption). Reuses
// fitMultivariateOLS/predictMultivariate from gcomp.ts rather than
// re-implementing OLS.
//
// The true estimand is E[Y|do(X=x)] = Sum_m P(M=m|X=x) * Sum_x' E[Y|M=m,X=x']
// * P(X=x'). This implementation plugs in the conditional mean M-hat = E[M|X=x]
// (stage 1's fitted value) as a single representative draw for the outer sum
// over M, rather than integrating over M's full conditional distribution --
// exact for this linear specification (E[Y|M,X] is affine in M, so averaging
// it over any distribution of M with the same mean gives the same answer),
// and a standard practical simplification more generally. The inner sum
// (Sum_x' ... P(X=x')) is a genuine Monte Carlo average over every observed
// row's X value, mirroring gcompDoseResponse's own g-formula loop.
//
// Scope: a single mediator, no additional exogenous controls -- matches
// iv2sls's single-instrument precedent. A full Set<NodeId> mediator set is
// supported by graph's frontdoorValid but not by this estimator yet.
//
// Known limitation: no collinearity guard. If the mediator has (near-)zero
// residual variance given X -- e.g. a user writes "M = 2*X" with no +eps
// term, or sets noise sigma to 0 -- stage 2's design matrix [1, M, X]
// becomes (near-)rank-deficient. fitMultivariateOLS doesn't detect this;
// mathjs's lusolve silently returns *some* solution to the near-singular
// normal equations rather than throwing, so the fitted split between the
// M-coefficient and the X-coefficient becomes numerically arbitrary even
// though nothing crashes. See frontdoor.test.ts's "known limitation" case.
import type { NodeId } from 'scm-dsl';
import type { ObservedSample } from 'scm-engine';
import { fitMultivariateOLS, predictMultivariate } from './gcomp.js';

export interface FrontdoorResult {
  grid: number[];
  ys: number[];
  /** Product of the two stage coefficients -- the front-door effect estimate. */
  estimate: number;
}

export function frontdoorDoseResponse(observed: ObservedSample, treatment: NodeId, outcome: NodeId, mediator: NodeId, grid: number[]): FrontdoorResult {
  const xCol = observed.columns.get(treatment);
  const yCol = observed.columns.get(outcome);
  const mCol = observed.columns.get(mediator);
  if (!xCol || !yCol || !mCol) {
    throw new Error(`treatment "${treatment}", outcome "${outcome}", or mediator "${mediator}" missing from observed sample`);
  }
  const n = xCol.length;

  // Stage 1: M ~ X.
  const stage1 = fitMultivariateOLS([xCol], mCol);

  // Stage 2: Y ~ M + X (X included to block the M -> Y backdoor path).
  const stage2 = fitMultivariateOLS([mCol, xCol], yCol);
  const estimate = stage1.coefficients[0]! * stage2.coefficients[0]!;

  const ys = grid.map((x) => {
    const mHat = predictMultivariate(stage1, [x]);
    let sum = 0;
    for (let i = 0; i < n; i++) sum += predictMultivariate(stage2, [mHat, xCol[i]!]);
    return sum / n;
  });

  return { grid, ys, estimate };
}
