import { describe, expect, it } from 'vitest';
import { sampleToCsv } from './exportCsv.js';

describe('sampleToCsv', () => {
  it('writes a header row and one row per observation, in column order', () => {
    const observed = {
      n: 3,
      columns: new Map([
        ['X', Float64Array.from([1, 2, 3])],
        ['Y', Float64Array.from([4.5, 5.5, 6.5])],
      ]),
    };

    const csv = sampleToCsv(observed);

    expect(csv).toBe('X,Y\n1,4.5\n2,5.5\n3,6.5\n');
  });

  it('handles a single-column sample', () => {
    const observed = { n: 2, columns: new Map([['Z', Float64Array.from([0, 1])]]) };
    expect(sampleToCsv(observed)).toBe('Z\n0\n1\n');
  });
});
