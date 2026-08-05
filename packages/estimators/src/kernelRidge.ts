// ARCHITECTURE.md §8's "flexible-in-X basis" option, implemented as a
// nonparametric alternative to gcomp's polynomial basis: kernel ridge
// regression with an RBF kernel over the full predictor vector (treatment +
// adjustment covariates, jointly). Fits alpha = (K + lambda*I)^-1 y in the
// dual, then estimates E[Y | do(X=x)] the same way gcompDoseResponse does --
// predicting at (x, Z_i) for every observed row and averaging over the
// empirical distribution of Z (the g-formula).
//
// The n x n solve is hand-rolled Cholesky on flat Float64Arrays rather than
// mathjs's lusolve: K + lambda*I is symmetric positive-definite, so Cholesky
// is half the flops of general LU, and mathjs's generic matrix wrapper is
// ~20x slower in practice than plain typed-array loops at this n (measured
// ~440ms vs ~24ms at n=500) -- the gap that made the app feel laggy on every
// keystroke of a bandwidth/lambda control.
import type { NodeId } from 'scm-dsl';
import type { ObservedSample } from 'scm-engine';

export interface KernelRidgeFit {
  /** n x d predictor rows the model was fit on (treatment + adjustment cols, raw units). */
  predictorRows: number[][];
  /** Dual coefficients, length n. */
  alpha: number[];
  bandwidth: number;
}

export interface KernelRidgeResult {
  grid: number[];
  ys: number[];
}

/** exp(-||a-b||^2 / (2*bandwidth^2)) over the raw predictor vector -- no
 * standardization, same "raw units" precedent as gcomp's polynomialBasis,
 * so the bandwidth stays a legible, literal unit the user is tuning. */
function rbfKernel(a: number[], b: number[], bandwidth: number): number {
  let sumSq = 0;
  for (let k = 0; k < a.length; k++) {
    const d = a[k]! - b[k]!;
    sumSq += d * d;
  }
  return Math.exp(-sumSq / (2 * bandwidth * bandwidth));
}

/** Cholesky decomposition (A = L L^T) of a flat, row-major, symmetric
 * positive-definite n x n matrix, then forward/back substitution to solve
 * A x = b. */
function choleskySolve(A: Float64Array, n: number, b: Float64Array): Float64Array {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j]!;
      for (let k = 0; k < j; k++) sum -= L[i * n + k]! * L[j * n + k]!;
      L[i * n + j] = i === j ? Math.sqrt(sum) : sum / L[j * n + j]!;
    }
  }

  const z = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = b[i]!;
    for (let k = 0; k < i; k++) sum -= L[i * n + k]! * z[k]!;
    z[i] = sum / L[i * n + i]!;
  }

  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let sum = z[i]!;
    for (let k = i + 1; k < n; k++) sum -= L[k * n + i]! * x[k]!;
    x[i] = sum / L[i * n + i]!;
  }
  return x;
}

export function fitKernelRidge(predictorRows: number[][], y: Float64Array, bandwidth: number, lambda: number): KernelRidgeFit {
  const n = y.length;
  // The kernel is symmetric, so only the upper triangle needs computing.
  const gram = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      const k = rbfKernel(predictorRows[i]!, predictorRows[j]!, bandwidth);
      gram[i * n + j] = k;
      gram[j * n + i] = k;
    }
    gram[i * n + i]! += lambda;
  }

  const alpha = Array.from(choleskySolve(gram, n, y));
  return { predictorRows, alpha, bandwidth };
}

export function predictKernelRidge(fit: KernelRidgeFit, predictorRow: number[]): number {
  let yhat = 0;
  for (let i = 0; i < fit.predictorRows.length; i++) yhat += fit.alpha[i]! * rbfKernel(predictorRow, fit.predictorRows[i]!, fit.bandwidth);
  return yhat;
}

/**
 * Estimates E[Y | do(X=x)] via g-computation with a kernel-ridge (RBF)
 * basis in the treatment instead of gcompDoseResponse's polynomial basis --
 * an alternative flexible-in-X fit for recovering nonlinear dose-response
 * curves without committing to a polynomial degree. `adjustmentSet: []` is
 * the "naive" case, same convention as gcompDoseResponse.
 */
export function kernelRidgeDoseResponse(
  observed: ObservedSample,
  treatment: NodeId,
  outcome: NodeId,
  adjustmentSet: NodeId[],
  grid: number[],
  bandwidth: number,
  lambda: number,
): KernelRidgeResult {
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
  const predictorRows: number[][] = [];
  for (let i = 0; i < n; i++) predictorRows.push([treatmentCol[i]!, ...adjustmentCols.map((col) => col[i]!)]);

  const fit = fitKernelRidge(predictorRows, outcomeCol, bandwidth, lambda);

  const ys = grid.map((x) => {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const predictorRow = [x, ...adjustmentCols.map((col) => col[i]!)];
      sum += predictKernelRidge(fit, predictorRow);
    }
    return sum / n;
  });

  return { grid, ys };
}
