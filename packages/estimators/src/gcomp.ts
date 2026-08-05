// ARCHITECTURE.md §8/METHODS.md §4: the `gcomp` estimator. Fits
// E[Y | X, Z] by OLS (this is internal numeric linear algebra on already-
// sampled data, not evaluating untrusted user expressions, so it uses the
// full mathjs instance directly rather than scm-dsl's restricted one), then
// estimates E[Y | do(X=x)] by predicting at (x, Z_i) for every observed row
// and averaging over the empirical distribution of Z -- the g-formula,
// Σ_z E[Y|X=x,Z=z]·P(Z=z), estimated nonparametrically over the sample.
import { all, create } from 'mathjs';
import type { NodeId } from 'scm-dsl';
import type { ObservedSample } from 'scm-engine';

// mathjs's own .d.ts destructures `all` from a `Record<string,
// FactoryFunctionMap>`, which noUncheckedIndexedAccess types as possibly
// undefined even though it's always present at runtime.
const math = create(all!, { predictable: true });

export interface MultivariateFit {
  intercept: number;
  /** One coefficient per predictor column, in the order passed to fit. */
  coefficients: number[];
}

function toFlatArray(value: unknown): number[] {
  const arr = (value as { valueOf?: () => unknown }).valueOf ? (value as { valueOf: () => unknown }).valueOf() : value;
  return (arr as unknown[]).map((v) => (Array.isArray(v) ? (v[0] as number) : (v as number)));
}

export function fitMultivariateOLS(predictorColumns: Float64Array[], y: Float64Array): MultivariateFit {
  const n = y.length;
  const p = predictorColumns.length;
  if (n <= p) throw new Error(`need more observations (${n}) than predictors (${p}) to fit OLS`);

  const designMatrix: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = [1];
    for (let j = 0; j < p; j++) row.push(predictorColumns[j]![i]!);
    designMatrix.push(row);
  }

  const xt = math.transpose(designMatrix);
  const xtx = math.multiply(xt, designMatrix);
  const xty = math.multiply(xt, Array.from(y));
  const beta = toFlatArray(math.lusolve(xtx, xty));

  return { intercept: beta[0]!, coefficients: beta.slice(1) };
}

export function predictMultivariate(fit: MultivariateFit, predictorRow: number[]): number {
  let yhat = fit.intercept;
  for (let j = 0; j < predictorRow.length; j++) yhat += fit.coefficients[j]! * predictorRow[j]!;
  return yhat;
}

export interface GcompResult {
  grid: number[];
  ys: number[];
}

/** [x, x^2, ..., x^degree] -- raw powers, not standardized. Standardizing
 * would change the units of the fitted degree-1 coefficient (per-SD instead
 * of per-raw-unit), breaking comparability with the already-validated
 * golden numbers (e.g. confounding.scm's naive slope ~3.38) at degree=1. */
export function polynomialBasis(x: number, degree: number): number[] {
  const basis: number[] = [];
  let power = x;
  for (let d = 1; d <= degree; d++) {
    basis.push(power);
    power *= x;
  }
  return basis;
}

export function polynomialColumns(col: Float64Array, degree: number): Float64Array[] {
  const columns = Array.from({ length: degree }, () => new Float64Array(col.length));
  for (let i = 0; i < col.length; i++) {
    const powers = polynomialBasis(col[i]!, degree);
    for (let d = 0; d < degree; d++) columns[d]![i] = powers[d]!;
  }
  return columns;
}

/**
 * Estimates E[Y | do(X=x)] via g-computation, with an optional polynomial
 * basis in the treatment (ARCHITECTURE.md §8's "flexible-in-X basis" for
 * recovering nonlinear dose-response). `adjustmentSet: []` is the `naive`
 * estimator -- OLS with no adjustment, at whatever degree is requested.
 */
export function gcompDoseResponse(observed: ObservedSample, treatment: NodeId, outcome: NodeId, adjustmentSet: NodeId[], grid: number[], treatmentDegree = 1): GcompResult {
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

  const treatmentBasisCols = polynomialColumns(treatmentCol, treatmentDegree);
  const fit = fitMultivariateOLS([...treatmentBasisCols, ...adjustmentCols], outcomeCol);
  const n = treatmentCol.length;

  const ys = grid.map((x) => {
    const xBasis = polynomialBasis(x, treatmentDegree);
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const predictorRow = [...xBasis, ...adjustmentCols.map((col) => col[i]!)];
      sum += predictMultivariate(fit, predictorRow);
    }
    return sum / n;
  });

  return { grid, ys };
}
