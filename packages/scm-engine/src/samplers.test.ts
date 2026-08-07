import { describe, expect, it } from 'vitest';
import { createRNG } from './rng.js';
import { sampleDistribution } from './samplers.js';
import type { CompiledExpr, Distribution } from 'scm-dsl';

function constantExpr(value: number): CompiledExpr {
  return { parents: [], usesNoise: false, eval: () => value };
}

function dist(name: string, params: number[]): Distribution {
  return {
    name,
    params: params.map((p) => constantExpr(p)),
    sample: () => {
      throw new Error('unused');
    },
  };
}

function sampleMany(distribution: Distribution, n: number): number[] {
  const rng = createRNG(1);
  const values: number[] = [];
  for (let i = 0; i < n; i++) values.push(sampleDistribution(distribution, {}, rng));
  return values;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe('Uniform sampler', () => {
  it('mean is close to (a+b)/2', () => {
    const values = sampleMany(dist('Uniform', [2, 8]), 50000);
    expect(mean(values)).toBeCloseTo(5, 1);
    expect(Math.min(...values)).toBeGreaterThanOrEqual(2);
    expect(Math.max(...values)).toBeLessThanOrEqual(8);
  });
});

describe('Poisson sampler', () => {
  it('mean is close to lambda', () => {
    const values = sampleMany(dist('Poisson', [4]), 50000);
    expect(mean(values)).toBeCloseTo(4, 0);
    expect(values.every((v) => Number.isInteger(v) && v >= 0)).toBe(true);
  });
});

describe('Binomial sampler', () => {
  it('mean is close to n*p, every value an integer in [0, n]', () => {
    const values = sampleMany(dist('Binomial', [10, 0.3]), 50000);
    expect(mean(values)).toBeCloseTo(3, 1);
    expect(values.every((v) => Number.isInteger(v) && v >= 0 && v <= 10)).toBe(true);
  });
});

describe('Categorical sampler', () => {
  it('empirical frequency of each category matches its probability; every value an integer in [0, k-1]', () => {
    const values = sampleMany(dist('Categorical', [0.2, 0.3, 0.5]), 50000);
    expect(values.every((v) => Number.isInteger(v) && v >= 0 && v <= 2)).toBe(true);
    const freq0 = values.filter((v) => v === 0).length / values.length;
    const freq1 = values.filter((v) => v === 1).length / values.length;
    const freq2 = values.filter((v) => v === 2).length / values.length;
    expect(freq0).toBeCloseTo(0.2, 2);
    expect(freq1).toBeCloseTo(0.3, 2);
    expect(freq2).toBeCloseTo(0.5, 2);
  });
});

describe('Exponential sampler', () => {
  it('mean is close to 1/rate, every value positive', () => {
    const values = sampleMany(dist('Exponential', [2]), 50000);
    expect(mean(values)).toBeCloseTo(0.5, 1);
    expect(values.every((v) => v > 0)).toBe(true);
  });
});

describe('Gamma sampler', () => {
  it('mean is close to shape/rate, shape >= 1 (direct Marsaglia-Tsang branch)', () => {
    const values = sampleMany(dist('Gamma', [3, 2]), 50000);
    expect(mean(values)).toBeCloseTo(1.5, 1);
    expect(values.every((v) => v > 0)).toBe(true);
  });

  it('mean is close to shape/rate, shape < 1 (boosted branch)', () => {
    const values = sampleMany(dist('Gamma', [0.5, 1]), 50000);
    expect(mean(values)).toBeCloseTo(0.5, 1);
    expect(values.every((v) => v > 0)).toBe(true);
  });
});

describe('Beta sampler', () => {
  it('mean is close to alpha/(alpha+beta), every value in [0, 1]', () => {
    const values = sampleMany(dist('Beta', [2, 3]), 50000);
    expect(mean(values)).toBeCloseTo(0.4, 1);
    expect(values.every((v) => v >= 0 && v <= 1)).toBe(true);
  });
});

describe('LogNormal sampler', () => {
  it('mean is close to exp(mu + sigma^2/2), every value positive', () => {
    const values = sampleMany(dist('LogNormal', [0, 1]), 50000);
    expect(mean(values)).toBeCloseTo(Math.exp(0.5), 1);
    expect(values.every((v) => v > 0)).toBe(true);
  });
});
