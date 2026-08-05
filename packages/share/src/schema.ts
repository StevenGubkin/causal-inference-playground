// ARCHITECTURE.md §12: the permalink payload shape. `Estimand`/`BasisMode`
// are redeclared here as literal unions rather than imported from `app` --
// they're currently local, unexported types in PlaygroundView.tsx, and
// `share` has (and should keep) no dependency on `app`.
export const SCHEMA_VERSION = 1;

export interface PermalinkQuery {
  treatment: string;
  outcome: string;
  adjustmentSet: string[];
  instrument: string;
  mediator: string;
  estimand: 'doseResponse' | 'ate';
  ateA: number;
  ateB: number;
  degree: number;
  basisMode: 'polynomial' | 'kernelRidge';
  bandwidth: number;
  lambda: number;
  noiseSD: number;
}

export interface PermalinkPayload {
  schemaVersion: number;
  model: string;
  query: PermalinkQuery;
  seed: number;
}

/** ARCHITECTURE.md §12's versioning INVARIANT: a link with no automated
 * migration path shows an explicit "created with an incompatible version"
 * message rather than silently misparsing or crashing. Empty today --
 * SCHEMA_VERSION 1 is the only version that has ever existed -- but the
 * infrastructure is here so a future breaking change to this shape doesn't
 * mean breaking every link issued before it. */
export type Migration = (old: unknown) => unknown;
export const migrations: Record<number, Migration> = {};
