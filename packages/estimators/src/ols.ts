// ARCHITECTURE.md §8: the `naive` estimator — plain OLS of outcome on
// treatment, no adjustment. Minimal standalone functions for now; the full
// Estimator interface (requirements()/applicable(), the identifiability
// gate) is a later pass once more than one estimator exists to gate.

export interface LinearFit {
  intercept: number;
  slope: number;
}

export function fitSimpleLinearRegression(xs: Float64Array, ys: Float64Array): LinearFit {
  const n = xs.length;
  if (n < 2) throw new Error('need at least 2 observations to fit a line');

  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    sxy += dx * (ys[i]! - meanY);
    sxx += dx * dx;
  }
  if (sxx === 0) throw new Error('treatment has zero variance; cannot fit a line');

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  return { intercept, slope };
}

export function predictOverGrid(fit: LinearFit, grid: number[]): number[] {
  return grid.map((x) => fit.intercept + fit.slope * x);
}
