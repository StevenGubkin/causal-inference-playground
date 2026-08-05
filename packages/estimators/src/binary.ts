// IPW/AIPW (and the UI's gating of them) are the first place this codebase needs to
// distinguish a binary (0/1) treatment column from a continuous one -- ObservedSample
// columns are uniformly Float64Array regardless of source distribution, so this is a
// runtime value check, not something inferrable from the Model IR.
export function isBinaryColumn(column: Float64Array): boolean {
  const EPS = 1e-9;
  for (const v of column) {
    if (Math.abs(v) > EPS && Math.abs(v - 1) > EPS) return false;
  }
  return true;
}
