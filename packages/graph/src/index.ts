// ARCHITECTURE.md §9: pure functions over the compiled Model.
export { ancestors, dSeparated, descendants } from './dsep.js';
export { backdoorValid, findBackdoorSet } from './backdoor.js';
export type { ValidityResult } from './backdoor.js';
export { frontdoorValid } from './frontdoor.js';
export { instrumentValid } from './instrument.js';
export { topoLayers } from './layers.js';
export { testableImplications } from './testable-implications.js';
export type { CIStatement } from './testable-implications.js';
