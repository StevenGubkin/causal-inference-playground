import { describe, expect, it } from 'vitest';
import { standardNormalCDF, standardNormalQuantile } from './normal.js';

describe('standardNormalCDF', () => {
  it('matches known reference values', () => {
    expect(standardNormalCDF(0)).toBeCloseTo(0.5, 8);
    expect(standardNormalCDF(1.96)).toBeCloseTo(0.975, 3);
    expect(standardNormalCDF(-1.96)).toBeCloseTo(0.025, 3);
    expect(standardNormalCDF(1.6449)).toBeCloseTo(0.95, 3);
  });
});

describe('standardNormalQuantile', () => {
  it('matches known reference values', () => {
    expect(standardNormalQuantile(0.5)).toBeCloseTo(0, 8);
    expect(standardNormalQuantile(0.975)).toBeCloseTo(1.959964, 5);
    expect(standardNormalQuantile(0.025)).toBeCloseTo(-1.959964, 5);
    expect(standardNormalQuantile(0.95)).toBeCloseTo(1.644854, 5);
  });

  it('throws outside (0, 1)', () => {
    expect(() => standardNormalQuantile(0)).toThrow(/\(0, 1\)/);
    expect(() => standardNormalQuantile(1)).toThrow(/\(0, 1\)/);
    expect(() => standardNormalQuantile(-0.1)).toThrow(/\(0, 1\)/);
  });
});

describe('CDF/quantile round-trip', () => {
  it('standardNormalQuantile(standardNormalCDF(x)) recovers x', () => {
    for (const x of [-3, -1.5, -0.3, 0, 0.3, 1.5, 3]) {
      expect(standardNormalQuantile(standardNormalCDF(x))).toBeCloseTo(x, 6);
    }
  });
});
