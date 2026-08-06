// Shared clamp functions for the numeric controls that don't have any other
// self-healing fallback (contrast with treatment/outcome/instrument/mediator,
// which effectiveX-style derivation already sanitizes on every render).
// Used in two places: the existing UI <input>'s onChange handlers -- whose
// JSX min/max attributes turned out to be cosmetic only, never actually
// enforced, so typing a large value already reached gcompDoseResponse's
// polynomial design matrix unclamped -- and permalink-decoded initial state,
// which bypasses the <input> entirely. One implementation, two call sites,
// so neither path can drift out of sync with the other.
export function clampDegree(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(9, Math.max(1, Math.round(n)));
}

export function clampBandwidth(n: number): number {
  if (!Number.isFinite(n) || n < 0.05) return 0.05;
  return n;
}

export function clampLambda(n: number): number {
  if (!Number.isFinite(n) || n < 0.0001) return 0.0001;
  return n;
}

export function clampNoiseSD(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(5, Math.max(0, n));
}

export function clampReplicateCount(n: number): number {
  if (!Number.isFinite(n)) return 200;
  return Math.min(1000, Math.max(10, Math.round(n)));
}
