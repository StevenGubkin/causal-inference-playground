// ARCHITECTURE.md §8/METHODS.md §4: the `ipw` estimator -- Horvitz-Thompson /
// Hajek-normalized inverse-propensity weighting, with METHODS.md's named
// diagnostics ("the tool surfaces the minimum overlap and the effective
// sample size").
import type { NodeId } from 'scm-dsl';
import type { ObservedSample } from 'scm-engine';
import { isBinaryColumn } from './binary.js';
import { fitLogisticRegression, predictProbability, type LogisticFit } from './logistic.js';

const PROPENSITY_CLIP = 1e-3;

export interface PropensityFit {
  fit: LogisticFit;
  /** Raw P(X=1|Z_i), one per row, unclipped. */
  propensities: number[];
  /** Same, clipped to [PROPENSITY_CLIP, 1-PROPENSITY_CLIP] for safe division. */
  clippedPropensities: number[];
}

export interface OverlapDiagnostics {
  /** min over i of (p_i if treated, 1-p_i if control) -- the unclipped
   * probability of the treatment level each unit actually received. Small
   * values mean some units are barely distinguishable from certainly-
   * treated or certainly-control, i.e. poor positivity/overlap. */
  minOverlap: number;
  /** Kish's effective sample size, (sum w)^2 / sum(w^2), computed
   * separately per arm on the clipped IPW weights (w=1/p for treated,
   * w=1/(1-p) for control) -- how many "effective" independent
   * observations the reweighted arm behaves like; well below the raw
   * arm count signals a few large weights are dominating the estimate. */
  effectiveSampleSizeTreated: number;
  effectiveSampleSizeControl: number;
}

/** Shared by ipw.ts and aipw.ts so both use one propensity-fitting/clipping/
 * diagnostics code path rather than two that could drift apart. */
export function fitPropensity(adjustmentCols: Float64Array[], treatmentCol: Float64Array): PropensityFit {
  const fit = fitLogisticRegression(adjustmentCols, treatmentCol);
  const n = treatmentCol.length;
  const propensities: number[] = [];
  const clippedPropensities: number[] = [];
  for (let i = 0; i < n; i++) {
    const p = predictProbability(fit, adjustmentCols.map((col) => col[i]!));
    propensities.push(p);
    clippedPropensities.push(Math.min(Math.max(p, PROPENSITY_CLIP), 1 - PROPENSITY_CLIP));
  }
  return { fit, propensities, clippedPropensities };
}

export function overlapDiagnostics(treatmentCol: Float64Array, propensities: number[], clippedPropensities: number[]): OverlapDiagnostics {
  let minOverlap = Infinity;
  let sumWT = 0,
    sumWT2 = 0,
    sumWC = 0,
    sumWC2 = 0;
  for (let i = 0; i < treatmentCol.length; i++) {
    const treated = treatmentCol[i]! === 1;
    minOverlap = Math.min(minOverlap, treated ? propensities[i]! : 1 - propensities[i]!);
    if (treated) {
      const w = 1 / clippedPropensities[i]!;
      sumWT += w;
      sumWT2 += w * w;
    } else {
      const w = 1 / (1 - clippedPropensities[i]!);
      sumWC += w;
      sumWC2 += w * w;
    }
  }
  return {
    minOverlap,
    effectiveSampleSizeTreated: (sumWT * sumWT) / sumWT2,
    effectiveSampleSizeControl: (sumWC * sumWC) / sumWC2,
  };
}

export interface IpwResult extends OverlapDiagnostics {
  /** Hajek-normalized ATE, E[Y|do(X=1)] - E[Y|do(X=0)]. */
  estimate: number;
  grid: number[];
  ys: number[];
}

/**
 * Grid/ys: included following iv2sls.ts's precedent -- a method whose real
 * estimand is a single scalar contrast, but which still gets a line drawn
 * through the app's continuous grid for visual comparability on
 * ComparisonChart. For a binary treatment the grid naturally spans [0, 1],
 * so `ys[i] = muC + estimate*grid[i]` is the literal straight line between
 * the two valid potential-outcome means, not an approximation stretched
 * across an arbitrary range.
 */
export function ipwAte(observed: ObservedSample, treatment: NodeId, outcome: NodeId, adjustmentSet: NodeId[], grid: number[]): IpwResult {
  const treatmentCol = observed.columns.get(treatment);
  const outcomeCol = observed.columns.get(outcome);
  if (!treatmentCol || !outcomeCol) {
    throw new Error(`treatment "${treatment}" or outcome "${outcome}" missing from observed sample`);
  }
  if (!isBinaryColumn(treatmentCol)) {
    throw new Error(`ipw requires a binary (0/1) treatment column; "${treatment}" has non-binary values -- try gcomp or kernel-ridge gcomp for a continuous treatment`);
  }
  const adjustmentCols = adjustmentSet.map((id) => {
    const col = observed.columns.get(id);
    if (!col) throw new Error(`adjustment covariate "${id}" missing from observed sample`);
    return col;
  });

  const { propensities, clippedPropensities } = fitPropensity(adjustmentCols, treatmentCol);
  const diagnostics = overlapDiagnostics(treatmentCol, propensities, clippedPropensities);

  let numT = 0,
    denT = 0,
    numC = 0,
    denC = 0;
  for (let i = 0; i < treatmentCol.length; i++) {
    if (treatmentCol[i] === 1) {
      const w = 1 / clippedPropensities[i]!;
      numT += w * outcomeCol[i]!;
      denT += w;
    } else {
      const w = 1 / (1 - clippedPropensities[i]!);
      numC += w * outcomeCol[i]!;
      denC += w;
    }
  }
  const muT = numT / denT;
  const muC = numC / denC;
  const estimate = muT - muC;

  const ys = grid.map((x) => muC + estimate * x);

  return { estimate, grid, ys, ...diagnostics };
}
