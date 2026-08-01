// ARCHITECTURE.md §9: pure functions over the compiled Model. `frontdoorValid`
// and `testableImplications` (the dagitty cross-check) are still deferred --
// no front-door estimator exists yet to gate.
export { ancestors, dSeparated, descendants } from './dsep.js';
export { backdoorValid, findBackdoorSet } from './backdoor.js';
export type { ValidityResult } from './backdoor.js';
export { instrumentValid } from './instrument.js';
export { topoLayers } from './layers.js';
