import type { Model, NodeId, RNG } from 'scm-dsl';
import { forwardSample } from 'scm-engine';
import type { ObservedSample } from 'scm-engine';
import {
  aipwAte,
  frontdoorDoseResponse,
  gcompDoseResponse,
  ipwAte,
  isBinaryColumn,
  iv2sls,
  kernelRidgeDoseResponse,
  stratifyDoseResponse,
} from 'estimators';

export interface EstimatorConfig {
  treatment: NodeId;
  outcome: NodeId;
  ateA: number;
  ateB: number;
  adjustment: NodeId[];
  basisMode: 'polynomial' | 'kernelRidge';
  degree: number;
  bandwidth: number;
  lambda: number;
  instrument: string; // '' = none
  mediator: string; // '' = none
}

export interface MonteCarloConfig extends EstimatorConfig {
  model: Model;
  sampleSize: number;
  noiseSD: number;
}

export interface MonteCarloReplicate {
  naive: number | null;
  gcomp: number | null;
  stratify: number | null;
  ipw: number | null;
  aipw: number | null;
  iv: number | null;
  frontdoor: number | null;
}

function contrast(fn: () => { ys: number[] }): number | null {
  try {
    const c = fn();
    return c.ys[1]! - c.ys[0]!;
  } catch {
    return null;
  }
}

/** Every currently-applicable estimator run against `observed` as-is. Mirrors
 * PlaygroundView.tsx's `run` memo gating exactly (empty adjustment set ->
 * gcomp/stratify skip; isBinaryColumn -> ipw/aipw; instrument/mediator
 * presence -> iv/frontdoor) so every caller's active-estimator set always
 * matches what the single-run view is already showing. Every estimator call
 * is wrapped individually -- a replicate loop of hundreds (Monte Carlo mode)
 * or a bootstrap/jackknife pass (bootstrapCi.ts) makes rare data-dependent
 * throws (stratify's cardinality guard above all, but defensively all of
 * them) far more likely to actually occur than in a single run, and one bad
 * replicate must not abort the whole batch.
 *
 * Factored out from runMonteCarloReplicate so bootstrap/jackknife replicates
 * (bootstrapCi.ts) can drive this exact gating with resampled or
 * leave-one-out data instead of a fresh forwardSample, without duplicating
 * (and risking drifting out of sync with) the rules above. */
export function computeEstimateSet(observed: ObservedSample, config: EstimatorConfig): MonteCarloReplicate {
  const points = [config.ateA, config.ateB];

  function computeCurve(adjustment: NodeId[]) {
    return config.basisMode === 'polynomial'
      ? gcompDoseResponse(observed, config.treatment, config.outcome, adjustment, points, config.degree)
      : kernelRidgeDoseResponse(observed, config.treatment, config.outcome, adjustment, points, config.bandwidth, config.lambda);
  }

  const naive = contrast(() => computeCurve([]));
  const gcomp = config.adjustment.length > 0 ? contrast(() => computeCurve(config.adjustment)) : null;

  const stratify =
    config.basisMode === 'polynomial' && config.adjustment.length > 0
      ? contrast(() => stratifyDoseResponse(observed, config.treatment, config.outcome, config.adjustment, points, config.degree))
      : null;

  const treatmentCol = observed.columns.get(config.treatment)!;
  const isBinaryTreatment = isBinaryColumn(treatmentCol);
  const ipw = isBinaryTreatment ? contrast(() => ipwAte(observed, config.treatment, config.outcome, config.adjustment, points)) : null;
  const aipw = isBinaryTreatment ? contrast(() => aipwAte(observed, config.treatment, config.outcome, config.adjustment, points)) : null;

  const iv = config.instrument
    ? (() => {
        try {
          return iv2sls(observed, config.treatment, config.outcome, config.instrument, points).estimate;
        } catch {
          return null;
        }
      })()
    : null;

  const frontdoor = config.mediator
    ? (() => {
        try {
          return frontdoorDoseResponse(observed, config.treatment, config.outcome, config.mediator, points).estimate;
        } catch {
          return null;
        }
      })()
    : null;

  return { naive, gcomp, stratify, ipw, aipw, iv, frontdoor };
}

/** One Monte Carlo replicate: fresh resample at `rng`, every currently-
 * applicable estimator run against it (see computeEstimateSet's doc comment
 * for the gating rules this reuses). */
export function runMonteCarloReplicate(config: MonteCarloConfig, rng: RNG): MonteCarloReplicate {
  const observed = forwardSample(config.model, config.sampleSize, rng, config.noiseSD).observed();
  return computeEstimateSet(observed, config);
}

export interface MonteCarloSummary {
  values: number[]; // successful replicate estimates only
  failures: number;
  bias: number; // mean(values) - trueValue; NaN if values is empty
  rmse: number; // sqrt(mean((v - trueValue)^2)); NaN if values is empty
}

export function summarizeReplicates(estimates: (number | null)[], trueValue: number): MonteCarloSummary {
  const values = estimates.filter((v): v is number => v !== null && Number.isFinite(v));
  const failures = estimates.length - values.length;
  if (values.length === 0) return { values, failures, bias: NaN, rmse: NaN };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const bias = mean - trueValue;
  const rmse = Math.sqrt(values.reduce((s, v) => s + (v - trueValue) ** 2, 0) / values.length);
  return { values, failures, bias, rmse };
}
