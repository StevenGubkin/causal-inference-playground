// ARCHITECTURE.md §9: pure functions over the compiled Model. `frontdoorValid`,
// `instrumentValid`, and `testableImplications` (the dagitty cross-check) are
// deferred -- no front-door or IV/2SLS estimator exists yet to gate, so
// there's no UI payoff in building their validity checks before that.
export { ancestors, dSeparated, descendants } from './dsep.js';
export { backdoorValid, findBackdoorSet } from './backdoor.js';
export type { ValidityResult } from './backdoor.js';
export { topoLayers } from './layers.js';
