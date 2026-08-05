// ARCHITECTURE.md §8: naive, gcomp, stratify, ipw, aipw, iv2sls, frontdoor —
// each declares requirements()/applicable() against the graph package before
// estimate() runs. Zero UI dependencies (§3).
export { gcompDoseResponse, fitMultivariateOLS, predictMultivariate } from './gcomp.js';
export type { GcompResult, MultivariateFit } from './gcomp.js';
export { kernelRidgeDoseResponse, fitKernelRidge, predictKernelRidge } from './kernelRidge.js';
export type { KernelRidgeResult, KernelRidgeFit } from './kernelRidge.js';
export { iv2sls } from './iv2sls.js';
export type { Iv2slsResult } from './iv2sls.js';
export { frontdoorDoseResponse } from './frontdoor.js';
export type { FrontdoorResult } from './frontdoor.js';
export { fitSimpleLinearRegression, predictOverGrid } from './ols.js';
export type { LinearFit } from './ols.js';
export { isBinaryColumn } from './binary.js';
export { fitLogisticRegression, predictProbability } from './logistic.js';
export type { LogisticFit } from './logistic.js';
export { stratifyDoseResponse } from './stratify.js';
export type { StratifyResult } from './stratify.js';
export { ipwAte, fitPropensity, overlapDiagnostics } from './ipw.js';
export type { IpwResult, PropensityFit, OverlapDiagnostics } from './ipw.js';
export { aipwAte } from './aipw.js';
export type { AipwResult } from './aipw.js';
