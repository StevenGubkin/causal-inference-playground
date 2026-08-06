import { createRNG } from 'scm-engine';
import type { ObservedSample } from 'scm-engine';
import { describe, expect, it } from 'vitest';
import { leaveOneOut, resampleRows } from './bootstrap.js';

// Y = 2*X for every row -- the property that distinguishes a valid *joint*
// resample (same drawn row index used for every column) from independently
// shuffling each column.
function alignedFixture(n: number): ObservedSample {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = i;
    y[i] = 2 * i;
  }
  return { n, columns: new Map([['X', x], ['Y', y]]) };
}

describe('resampleRows', () => {
  it('preserves n and draws every value from the original column', () => {
    const observed = alignedFixture(20);
    const resampled = resampleRows(observed, createRNG(1));
    expect(resampled.n).toBe(20);
    const originalX = new Set(Array.from(observed.columns.get('X')!));
    for (const v of resampled.columns.get('X')!) expect(originalX.has(v)).toBe(true);
  });

  it('preserves row alignment across columns (Y = 2*X still holds per row)', () => {
    const observed = alignedFixture(50);
    const resampled = resampleRows(observed, createRNG(7));
    const rx = resampled.columns.get('X')!;
    const ry = resampled.columns.get('Y')!;
    for (let i = 0; i < resampled.n; i++) expect(ry[i]).toBe(2 * rx[i]!);
  });

  it('is deterministic for a fixed rng seed', () => {
    const observed = alignedFixture(30);
    const a = resampleRows(observed, createRNG(42));
    const b = resampleRows(observed, createRNG(42));
    expect(Array.from(a.columns.get('X')!)).toEqual(Array.from(b.columns.get('X')!));
  });
});

describe('leaveOneOut', () => {
  it('returns n-1 rows and drops exactly the requested row', () => {
    const observed = alignedFixture(10);
    const dropped = leaveOneOut(observed, 3);
    expect(dropped.n).toBe(9);
    expect(Array.from(dropped.columns.get('X')!)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9]);
  });

  it('preserves row alignment across columns', () => {
    const observed = alignedFixture(10);
    const dropped = leaveOneOut(observed, 5);
    const dx = dropped.columns.get('X')!;
    const dy = dropped.columns.get('Y')!;
    for (let i = 0; i < dropped.n; i++) expect(dy[i]).toBe(2 * dx[i]!);
  });
});
