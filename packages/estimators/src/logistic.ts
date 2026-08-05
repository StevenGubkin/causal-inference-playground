// ARCHITECTURE.md §8/METHODS.md §4: a propensity-score fitter for ipw.ts/aipw.ts.
// No logistic regression exists anywhere else in the codebase. IRLS/Newton-Raphson
// on the Bernoulli log-likelihood, reusing mathjs's lusolve the way gcomp.ts does
// for its OLS normal equations (not kernelRidge.ts's hand-rolled Cholesky) -- this
// solve is p x p (p = 1 + |adjustment set|, a handful of covariates), run a fixed
// ~10-20 times per call, not per keystroke of a live slider, so mathjs's overhead
// is negligible here unlike kernel-ridge's n x n per-keystroke solve.
import { all, create } from 'mathjs';

const math = create(all!, { predictable: true });

export interface LogisticFit {
  intercept: number;
  /** One coefficient per predictor column, in the order passed to fit. */
  coefficients: number[];
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function toFlatArray(value: unknown): number[] {
  const arr = (value as { valueOf?: () => unknown }).valueOf ? (value as { valueOf: () => unknown }).valueOf() : value;
  return (arr as unknown[]).map((v) => (Array.isArray(v) ? (v[0] as number) : (v as number)));
}

/**
 * Fits P(y=1 | predictors) via IRLS/Newton-Raphson on the Bernoulli
 * log-likelihood. `y` must already be 0/1 (callers -- ipw.ts/aipw.ts --
 * validate the treatment column is binary with isBinaryColumn before
 * calling; this function itself is a generic 0/1-GLM fitter, no
 * ipw-specific validation or error wording).
 *
 * Convergence: stops when the Newton step's max-abs coordinate change drops
 * below `tol`, or after `maxIter` iterations, whichever comes first --
 * `maxIter` is a soft iteration cap, not an error condition (returns
 * whatever beta the last completed iteration produced).
 *
 * Known limitation (same category as frontdoor.ts's documented
 * collinearity gap): (quasi-)complete separation -- a predictor that
 * perfectly predicts y -- drives beta toward +/-infinity and the IRLS
 * weights w=mu(1-mu) toward 0, which can make the p x p system
 * ill-conditioned. No special guard here; mathjs's lusolve either returns
 * a degenerate (huge-magnitude) solution or throws on an exactly singular
 * matrix, in which case the error propagates rather than being silently
 * swallowed.
 */
export function fitLogisticRegression(predictorColumns: Float64Array[], y: Float64Array, maxIter = 25, tol = 1e-8): LogisticFit {
  const n = y.length;
  const p = predictorColumns.length;
  if (n <= p) throw new Error(`need more observations (${n}) than predictors (${p}) to fit a logistic regression`);

  const designMatrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [1];
    for (let j = 0; j < p; j++) row.push(predictorColumns[j]![i]!);
    designMatrix.push(row);
  }

  let beta = new Array(p + 1).fill(0); // beta=0 -> mu=0.5 everywhere, a safe start

  for (let iter = 0; iter < maxIter; iter++) {
    const mu = designMatrix.map((row) => logistic(row.reduce((s, x, k) => s + x * beta[k]!, 0)));
    // IRLS weight, floored away from exactly 0 to keep X^T W X nonsingular
    // even where mu saturates near 0/1.
    const w = mu.map((m) => Math.max(m * (1 - m), 1e-10));
    const residual = mu.map((m, i) => y[i]! - m);

    const wx = designMatrix.map((row, i) => row.map((x) => x * w[i]!));
    const xt = math.transpose(designMatrix);
    const xtwx = math.multiply(xt, wx);
    const xtr = math.multiply(xt, residual);
    const delta = toFlatArray(math.lusolve(xtwx, xtr));

    beta = beta.map((b, k) => b + delta[k]!);
    if (Math.max(...delta.map(Math.abs)) < tol) break;
  }

  return { intercept: beta[0]!, coefficients: beta.slice(1) };
}

export function predictProbability(fit: LogisticFit, predictorRow: number[]): number {
  let eta = fit.intercept;
  for (let j = 0; j < predictorRow.length; j++) eta += fit.coefficients[j]! * predictorRow[j]!;
  return logistic(eta);
}
