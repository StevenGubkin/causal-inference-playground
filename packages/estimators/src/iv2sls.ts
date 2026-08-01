// ARCHITECTURE.md §8: the `iv2sls` estimator. Textbook two-stage least
// squares -- stage 1 regresses treatment on the instrument, stage 2
// regresses outcome on the stage-1 fitted values. Reuses fitMultivariateOLS/
// predictMultivariate from gcomp.ts rather than re-implementing OLS.
//
// IV/LATE precision (ARCHITECTURE.md §8): this recovers the population ATE
// only under constant/linear treatment effects. Under effect heterogeneity
// with a binary instrument and monotonicity, it identifies the LATE (the
// complier average) instead -- see METHODS.md's worked construction. The UI
// is responsible for showing this alongside the oracle's true population
// ATE so the divergence is visible, not for relabeling the number itself.
//
// Scope: a single instrument, no additional exogenous controls -- matches
// iv-late.scm (whose confounding is entirely through a latent, so there's
// no valid *observed* backdoor set to control for anyway). Combined
// instrument+adjustment-set 2SLS is a natural future extension.
import type { NodeId } from 'scm-dsl';
import type { ObservedSample } from 'scm-engine';
import { fitMultivariateOLS, predictMultivariate } from './gcomp.js';

export interface Iv2slsResult {
  grid: number[];
  ys: number[];
  estimate: number;
  /** First-stage F statistic (weak-instrument diagnostic): compares the
   * D~Z fit against an intercept-only baseline. Conventionally, F < 10 is
   * treated as a weak instrument (Staiger-Stock). */
  firstStageF: number;
}

function sumSquares(values: Iterable<number>): number {
  let sum = 0;
  for (const v of values) sum += v * v;
  return sum;
}

export function iv2sls(observed: ObservedSample, treatment: NodeId, outcome: NodeId, instrument: NodeId, grid: number[]): Iv2slsResult {
  const dCol = observed.columns.get(treatment);
  const yCol = observed.columns.get(outcome);
  const zCol = observed.columns.get(instrument);
  if (!dCol || !yCol || !zCol) {
    throw new Error(`treatment "${treatment}", outcome "${outcome}", or instrument "${instrument}" missing from observed sample`);
  }
  const n = dCol.length;

  // Stage 1: D ~ Z.
  const stage1 = fitMultivariateOLS([zCol], dCol);
  const dHat = new Float64Array(n);
  for (let i = 0; i < n; i++) dHat[i] = predictMultivariate(stage1, [zCol[i]!]);

  // Stage 2: Y ~ D_hat. The coefficient on D_hat is the 2SLS estimate.
  const stage2 = fitMultivariateOLS([dHat], yCol);
  const estimate = stage2.coefficients[0]!;

  // First-stage F: (RSS_restricted - RSS_unrestricted) / q, over
  // RSS_unrestricted / (n - k), q=1 excluded instrument, k=2 params
  // (intercept + Z coefficient) in the unrestricted first stage.
  let dMean = 0;
  for (let i = 0; i < n; i++) dMean += dCol[i]!;
  dMean /= n;
  const rssRestricted = sumSquares([...dCol].map((d) => d - dMean));
  const rssUnrestricted = sumSquares([...dCol].map((d, i) => d - dHat[i]!));
  const firstStageF = (rssRestricted - rssUnrestricted) / (rssUnrestricted / (n - 2));

  const ys = grid.map((d) => predictMultivariate(stage2, [d]));

  return { grid, ys, estimate, firstStageF };
}
