// ARCHITECTURE.md §6: seeded RNG, forwardSample, and the Oracle
// (doResponse/doContrast via graph mutilation + common random numbers).
// Zero UI dependencies (§3) — compiled/executed only inside the worker pool,
// never on the main thread (§3, §11).
export { doContrast, doResponse, lateContrast } from './oracle.js';
export type { Curve, LateResult } from './oracle.js';
export { createRNG } from './rng.js';
export { forwardSample } from './sample.js';
export type { ObservedSample, Sample } from './sample.js';
export { sampleDistribution } from './samplers.js';
