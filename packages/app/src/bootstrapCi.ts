import type { RNG } from 'scm-dsl';
import type { ObservedSample } from 'scm-engine';
import { leaveOneOut, resampleRows, standardNormalCDF, standardNormalQuantile } from 'estimators';
import { computeEstimateSet } from './monteCarlo.js';
import type { EstimatorConfig, MonteCarloReplicate } from './monteCarlo.js';

export type CIMethod = 'percentile' | 'basic' | 'bca';

const MIN_REPLICATE_SUCCESSES = 10;

export interface BootstrapCIResult {
  estimate: number; // point estimate on the real (unresampled) data
  lower: number | null; // null if too few successful replicates (or, for BCa, a degenerate acceleration/z0)
  upper: number | null;
  replicates: number; // successful bootstrap replicates used
  failures: number;
}

function percentile(sorted: number[], p: number): number {
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

function percentileCI(estimate: number, sorted: number[], failures: number, alpha: number): BootstrapCIResult {
  return { estimate, lower: percentile(sorted, alpha / 2), upper: percentile(sorted, 1 - alpha / 2), replicates: sorted.length, failures };
}

function basicCI(estimate: number, sorted: number[], failures: number, alpha: number): BootstrapCIResult {
  return {
    estimate,
    lower: 2 * estimate - percentile(sorted, 1 - alpha / 2),
    upper: 2 * estimate - percentile(sorted, alpha / 2),
    replicates: sorted.length,
    failures,
  };
}

/** BCa (Efron & Tibshirani 1993, ch. 14). z0 corrects for the bootstrap
 * distribution's own bias relative to `estimate`; `a` (from the jackknife's
 * skewness) corrects for non-constant variance/skew, the same property that
 * makes percentile transformation-respecting. Falls back to plain percentile
 * whenever the formula degenerates (z0 infinite, acceleration denominator
 * zero, or an adjusted alpha lands outside (0,1)) rather than propagating a
 * NaN interval -- a bad edge case here should visibly degrade to a simpler
 * method, never crash or silently mislead. */
function bcaCI(estimate: number, sorted: number[], failures: number, jackknife: number[], alpha: number): BootstrapCIResult {
  const B = sorted.length;
  const proportionBelow = Math.min(Math.max(sorted.filter((v) => v < estimate).length / B, 1 / (B + 1)), B / (B + 1));
  const z0 = standardNormalQuantile(proportionBelow);

  const mean = jackknife.reduce((s, v) => s + v, 0) / jackknife.length;
  const num = jackknife.reduce((s, v) => s + (mean - v) ** 3, 0);
  const den = 6 * jackknife.reduce((s, v) => s + (mean - v) ** 2, 0) ** 1.5;
  const a = den === 0 ? 0 : num / den;

  function adjusted(zAlpha: number): number | null {
    const denom = 1 - a * (z0 + zAlpha);
    if (denom === 0) return null;
    const p = standardNormalCDF(z0 + (z0 + zAlpha) / denom);
    return p > 0 && p < 1 ? p : null;
  }

  const alphaLo = adjusted(standardNormalQuantile(alpha / 2));
  const alphaHi = adjusted(standardNormalQuantile(1 - alpha / 2));
  if (alphaLo === null || alphaHi === null || !Number.isFinite(z0)) {
    return percentileCI(estimate, sorted, failures, alpha); // degenerate -- fall back rather than propagate NaN
  }
  return { estimate, lower: percentile(sorted, alphaLo), upper: percentile(sorted, alphaHi), replicates: B, failures };
}

export function computeCI(
  method: CIMethod,
  estimate: number,
  bootstrapValues: number[],
  failures: number,
  jackknifeValues: number[] | null,
  alpha = 0.05,
): BootstrapCIResult {
  if (bootstrapValues.length < MIN_REPLICATE_SUCCESSES) {
    return { estimate, lower: null, upper: null, replicates: bootstrapValues.length, failures };
  }
  const sorted = [...bootstrapValues].sort((a, b) => a - b);
  if (method === 'percentile') return percentileCI(estimate, sorted, failures, alpha);
  if (method === 'basic') return basicCI(estimate, sorted, failures, alpha);
  // bca
  if (!jackknifeValues || jackknifeValues.length < MIN_REPLICATE_SUCCESSES) {
    return percentileCI(estimate, sorted, failures, alpha); // not enough jackknife data -- degrade to percentile
  }
  return bcaCI(estimate, sorted, failures, jackknifeValues, alpha);
}

/** One bootstrap replicate: resample the real observed rows, run every
 * applicable estimator on that resample. Reuses computeEstimateSet so the
 * active-estimator gating can never drift from Monte Carlo mode's. */
export function runBootstrapReplicate(observed: ObservedSample, config: EstimatorConfig, rng: RNG): MonteCarloReplicate {
  return computeEstimateSet(resampleRows(observed, rng), config);
}

/** One jackknife replicate (BCa's acceleration term): drop row `i`, run
 * every applicable estimator on the remaining n-1 rows. */
export function runJackknifeReplicate(observed: ObservedSample, i: number, config: EstimatorConfig): MonteCarloReplicate {
  return computeEstimateSet(leaveOneOut(observed, i), config);
}
