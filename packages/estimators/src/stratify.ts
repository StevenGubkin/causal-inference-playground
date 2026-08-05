// ARCHITECTURE.md §8/METHODS.md §4: the `stratify` estimator -- "the exact
// back-door formula above when Z is discrete and low-cardinality: estimate
// E[Y|X=x,Z=z] within each stratum and average with weights P(Z=z)." Mirrors
// gcompDoseResponse's shape/signature, swapping gcomp's pooled regression-
// adjustment-for-Z for a genuinely nonparametric-in-Z stratified fit.
import type { NodeId } from 'scm-dsl';
import type { ObservedSample } from 'scm-engine';
import { fitMultivariateOLS, predictMultivariate, polynomialBasis, polynomialColumns } from './gcomp.js';

export interface StratifyResult {
  grid: number[];
  ys: number[];
}

/** Groups row indices by the exact tuple of adjustment-column values at that
 * row, rounding to 6 decimals first so floating-point representation noise
 * (e.g. two rows that are "the same" 0.30000000000000004 vs 0.3) doesn't
 * split what should be one stratum into two. Discrete-by-construction
 * sources (Bernoulli, Categorical, Poisson, Binomial) are exact integers
 * already and round-trip through this unaffected; this only matters for a
 * user who accidentally adjusts for a continuous covariate, which the
 * cardinality guard below rejects anyway. */
function groupByStrata(adjustmentCols: Float64Array[], n: number): Map<string, number[]> {
  const strata = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const key = adjustmentCols.map((col) => col[i]!.toFixed(6)).join('|');
    const rows = strata.get(key);
    if (rows) rows.push(i);
    else strata.set(key, [i]);
  }
  return strata;
}

/**
 * Estimates E[Y | do(X=x)] by stratification: within each distinct value of
 * the (jointly-considered) adjustment covariates, fit a degree-`treatmentDegree`
 * polynomial-in-X OLS model (reusing gcomp.ts's own basis/fit/predict, just
 * restricted to that stratum's rows), predict at every grid point, and
 * average across strata weighted by each stratum's empirical share n_z/n.
 * `adjustmentSet: []` collapses to a single stratum containing every row --
 * numerically identical to gcompDoseResponse's own `adjustmentSet: []` case
 * (same fitMultivariateOLS/predictMultivariate calls on the same inputs).
 *
 * Guard against the case METHODS.md flags as the core requirement ("discrete
 * and low-cardinality"): if a continuous covariate is adjusted for, nearly
 * every row is its own stratum, most strata have 1 observation, and the
 * within-stratum OLS (which needs strictly more rows than
 * treatmentDegree+1 parameters) is uninformative or fails outright. Rather
 * than let that surface as an obscure per-stratum "need more observations"
 * error from whichever stratum happens to be small, check cardinality
 * up front: if the number of distinct strata exceeds n / (treatmentDegree + 2)
 * -- i.e. strata would average fewer rows than the within-stratum fit
 * needs -- throw immediately with a clear, actionable message.
 */
export function stratifyDoseResponse(observed: ObservedSample, treatment: NodeId, outcome: NodeId, adjustmentSet: NodeId[], grid: number[], treatmentDegree = 1): StratifyResult {
  const treatmentCol = observed.columns.get(treatment);
  const outcomeCol = observed.columns.get(outcome);
  if (!treatmentCol || !outcomeCol) {
    throw new Error(`treatment "${treatment}" or outcome "${outcome}" missing from observed sample`);
  }
  const adjustmentCols = adjustmentSet.map((id) => {
    const col = observed.columns.get(id);
    if (!col) throw new Error(`adjustment covariate "${id}" missing from observed sample`);
    return col;
  });

  const n = treatmentCol.length;
  const strata = groupByStrata(adjustmentCols, n);

  const minAvgStratumSize = n / (treatmentDegree + 2);
  if (strata.size > minAvgStratumSize) {
    throw new Error(
      `too many strata (${strata.size}) for ${n} observations -- stratify needs a ` +
        `low-cardinality discrete adjustment set (METHODS.md §4); a continuous ` +
        `covariate makes almost every row its own stratum. Try gcomp instead.`,
    );
  }

  const ys = new Array(grid.length).fill(0);
  for (const rows of strata.values()) {
    const stratumTreatment = Float64Array.from(rows.map((i) => treatmentCol[i]!));
    const stratumOutcome = Float64Array.from(rows.map((i) => outcomeCol[i]!));
    let fit;
    try {
      fit = fitMultivariateOLS(polynomialColumns(stratumTreatment, treatmentDegree), stratumOutcome);
    } catch (err) {
      throw new Error(`stratum with ${rows.length} observation(s) has too few rows to fit a within-stratum regression: ${(err as Error).message}`);
    }
    const weight = rows.length / n;
    grid.forEach((x, gi) => {
      ys[gi] += weight * predictMultivariate(fit, polynomialBasis(x, treatmentDegree));
    });
  }

  return { grid, ys };
}
