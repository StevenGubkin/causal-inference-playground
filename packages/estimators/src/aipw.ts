// ARCHITECTURE.md §8/METHODS.md §4: the `aipw` estimator -- doubly-robust
// augmented IPW, composing ipw.ts's fitPropensity/overlapDiagnostics and
// gcomp.ts's fitMultivariateOLS/predictMultivariate rather than
// reimplementing either.
import type { NodeId } from 'scm-dsl';
import type { ObservedSample } from 'scm-engine';
import { fitMultivariateOLS, predictMultivariate } from './gcomp.js';
import { fitPropensity, overlapDiagnostics, type OverlapDiagnostics } from './ipw.js';
import { isBinaryColumn } from './binary.js';

export interface AipwResult extends OverlapDiagnostics {
  estimate: number;
  grid: number[];
  ys: number[];
}

/**
 * Doubly-robust ATE: tau_hat = mean_i[ mu1_i - mu0_i
 *   + X_i*(Y_i-mu1_i)/ps_i - (1-X_i)*(Y_i-mu0_i)/(1-ps_i) ],
 * where mu1_i/mu0_i are the outcome model's predictions at X=1/X=0 holding
 * Z_i fixed (a linear-in-X joint fit -- since X is binary, X^2=X, so a
 * higher-order treatment basis the way gcomp's treatmentDegree offers is
 * redundant here and intentionally not exposed), and ps_i is the (clipped)
 * propensity. Consistent if either the outcome model or the propensity
 * model is correctly specified (METHODS.md §4).
 *
 * `propensitySet`/`outcomeSet` default to `adjustmentSet` (the common "both
 * nuisance models use the same adjustment set" call), but can be set
 * independently -- the whole premise of a doubly-robust estimator is that
 * the two models are conceptually independent, so callers (e.g. tests
 * demonstrating the doubly-robust property) can deliberately misspecify
 * one while keeping the other correct.
 */
export function aipwAte(
  observed: ObservedSample,
  treatment: NodeId,
  outcome: NodeId,
  adjustmentSet: NodeId[],
  grid: number[],
  propensitySet: NodeId[] = adjustmentSet,
  outcomeSet: NodeId[] = adjustmentSet,
): AipwResult {
  const treatmentCol = observed.columns.get(treatment);
  const outcomeCol = observed.columns.get(outcome);
  if (!treatmentCol || !outcomeCol) {
    throw new Error(`treatment "${treatment}" or outcome "${outcome}" missing from observed sample`);
  }
  if (!isBinaryColumn(treatmentCol)) {
    throw new Error(`aipw requires a binary (0/1) treatment column; "${treatment}" has non-binary values -- try gcomp or kernel-ridge gcomp for a continuous treatment`);
  }
  const getCols = (set: NodeId[]) =>
    set.map((id) => {
      const col = observed.columns.get(id);
      if (!col) throw new Error(`adjustment covariate "${id}" missing from observed sample`);
      return col;
    });
  const propensityCols = getCols(propensitySet);
  const outcomeCols = getCols(outcomeSet);

  const { propensities, clippedPropensities } = fitPropensity(propensityCols, treatmentCol);
  const diagnostics = overlapDiagnostics(treatmentCol, propensities, clippedPropensities);

  const outcomeFit = fitMultivariateOLS([treatmentCol, ...outcomeCols], outcomeCol);
  const n = treatmentCol.length;

  let sumTau = 0;
  let sumMu0 = 0; // doubly-robust E[Y|do(X=0)] estimate, for the chart's baseline
  for (let i = 0; i < n; i++) {
    const zRow = outcomeCols.map((col) => col[i]!);
    const mu1 = predictMultivariate(outcomeFit, [1, ...zRow]);
    const mu0 = predictMultivariate(outcomeFit, [0, ...zRow]);
    const p = clippedPropensities[i]!;
    const aug = treatmentCol[i] === 1 ? (outcomeCol[i]! - mu1) / p : -(outcomeCol[i]! - mu0) / (1 - p);
    sumTau += mu1 - mu0 + aug;
    sumMu0 += mu0 + (treatmentCol[i] === 1 ? 0 : -(outcomeCol[i]! - mu0) / (1 - p));
  }
  const estimate = sumTau / n;
  const baseline = sumMu0 / n;

  const ys = grid.map((x) => baseline + estimate * x);

  return { estimate, grid, ys, ...diagnostics };
}
