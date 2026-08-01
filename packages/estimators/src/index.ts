// ARCHITECTURE.md §8: naive, gcomp, stratify, ipw, aipw, iv2sls, frontdoor —
// each declares requirements()/applicable() against the graph package before
// estimate() runs. Zero UI dependencies (§3).
export { gcompDoseResponse, fitMultivariateOLS, predictMultivariate } from './gcomp.js';
export type { GcompResult, MultivariateFit } from './gcomp.js';
export { fitSimpleLinearRegression, predictOverGrid } from './ols.js';
export type { LinearFit } from './ols.js';
