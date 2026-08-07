import type { RNG } from 'scm-dsl';
import { forwardSample } from 'scm-engine';
import { resampleRows } from 'estimators';
import { computeCI } from './bootstrapCi.js';
import type { BootstrapCIResult } from './bootstrapCi.js';
import { computeEstimateSet } from './monteCarlo.js';
import type { MonteCarloConfig, MonteCarloReplicate } from './monteCarlo.js';

// BCa excluded: its jackknife pass would add another n=SAMPLE_SIZE calls on
// top of an already R x inner cost -- infeasible interactively (see the CI
// coverage plan's benchmark).
export type CoverageCIMethod = 'percentile' | 'basic';

export interface CoverageReplicateResult {
  // Identical shape to runMonteCarloReplicate's output -- reused directly for
  // the histogram, never recomputed separately.
  estimates: MonteCarloReplicate;
  cis: Record<string, BootstrapCIResult | null>;
}

/** One outer Monte Carlo replicate, plus a small inner nonparametric
 * bootstrap around *that replicate's own sample* -- producing a CI for every
 * active estimator on that single replicate. The inner loop runs once, not
 * once per estimator key: each resample's one computeEstimateSet call already
 * yields every active estimator's value, exactly like the single-run CI
 * panel's runBootstrapReplicate (an earlier draft that looped per key was 5x
 * slower for no benefit -- caught by benchmarking before this shipped). */
export function runCoverageReplicate(config: MonteCarloConfig, method: CoverageCIMethod, innerReplicates: number, rng: RNG): CoverageReplicateResult {
  const observed = forwardSample(config.model, config.sampleSize, rng, config.noiseSD).observed();
  const point = computeEstimateSet(observed, config);

  const innerRecords: MonteCarloReplicate[] = [];
  for (let b = 0; b < innerReplicates; b++) {
    innerRecords.push(computeEstimateSet(resampleRows(observed, rng.fork(`inner-${b}`)), config));
  }

  const cis: Record<string, BootstrapCIResult | null> = {};
  (['naive', 'gcomp', 'stratify', 'ipw', 'aipw', 'iv', 'frontdoor'] as const).forEach((key) => {
    if (point[key] === null) {
      cis[key] = null;
      return;
    }
    const values = innerRecords.map((r) => r[key]).filter((v): v is number => v !== null);
    const failures = innerRecords.length - values.length;
    cis[key] = computeCI(method, point[key]!, values, failures, null);
  });

  return { estimates: point, cis };
}

export interface CoverageSummary {
  attempted: number; // outer replicates where this estimator's point estimate succeeded
  covered: number; // of those with a computable CI, how many contained the truth
  rate: number; // covered / (successful CIs); NaN if none were computable
}

export function summarizeCoverage(cis: (BootstrapCIResult | null)[], trueValue: number): CoverageSummary {
  const attempted = cis.filter((ci): ci is BootstrapCIResult => ci !== null);
  const withInterval = attempted.filter((ci) => ci.lower !== null && ci.upper !== null);
  const covered = withInterval.filter((ci) => ci.lower! <= trueValue && trueValue <= ci.upper!).length;
  return { attempted: attempted.length, covered, rate: withInterval.length === 0 ? NaN : covered / withInterval.length };
}
