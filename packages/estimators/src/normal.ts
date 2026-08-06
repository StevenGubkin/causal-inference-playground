// Standard normal CDF/inverse CDF -- needed by the BCa bootstrap CI
// (packages/app/src/bootstrapCi.ts) for its z0/acceleration adjustment, but
// generic enough to live here alongside the other hand-rolled numerics
// (fitLogisticRegression's IRLS, fitMultivariateOLS's lusolve call).
import { all, create } from 'mathjs';

// mathjs's own .d.ts destructures `all` from a `Record<string,
// FactoryFunctionMap>`, which noUncheckedIndexedAccess types as possibly
// undefined even though it's always present at runtime.
const math = create(all!, { predictable: true });

export function standardNormalCDF(x: number): number {
  return 0.5 * (1 + (math.erf(x / Math.SQRT2) as number));
}

// Peter Acklam's rational approximation to the standard normal inverse CDF
// (probit). Public-domain, widely republished; relative error < 1.15e-9 over
// (0, 1). mathjs has `erf` but not an inverse, so this is hand-written rather
// than pulling in a dependency for one function.
const A = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239e0];
const B = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
const C = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0, 4.374664141464968e0, 2.938163982698783e0];
const D = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0];
const P_LOW = 0.02425;

export function standardNormalQuantile(p: number): number {
  if (p <= 0 || p >= 1) throw new Error(`standardNormalQuantile: p must be in (0, 1), got ${p}`);

  if (p < P_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) /
      ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1)
    );
  }
  if (p <= 1 - P_LOW) {
    const q = p - 0.5;
    const r = q * q;
    return (
      ((((((A[0]! * r + A[1]!) * r + A[2]!) * r + A[3]!) * r + A[4]!) * r + A[5]!) * q) /
      (((((B[0]! * r + B[1]!) * r + B[2]!) * r + B[3]!) * r + B[4]!) * r + 1)
    );
  }
  const q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((C[0]! * q + C[1]!) * q + C[2]!) * q + C[3]!) * q + C[4]!) * q + C[5]!) /
    ((((D[0]! * q + D[1]!) * q + D[2]!) * q + D[3]!) * q + 1)
  );
}
