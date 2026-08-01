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
