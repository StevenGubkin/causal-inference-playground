import { describe, expect, it } from 'vitest';
import { clampBandwidth, clampCoverageInnerReplicates, clampDegree, clampLambda, clampNoiseSD, clampReplicateCount } from './limits.js';

describe('clampDegree', () => {
  it('clamps to [1, 9] and rounds', () => {
    expect(clampDegree(1)).toBe(1);
    expect(clampDegree(9)).toBe(9);
    expect(clampDegree(50)).toBe(9);
    expect(clampDegree(-3)).toBe(1);
    expect(clampDegree(3.7)).toBe(4);
    expect(clampDegree(NaN)).toBe(1);
    expect(clampDegree(Infinity)).toBe(1);
  });
});

describe('clampBandwidth', () => {
  it('enforces a positive floor and passes through otherwise-valid values', () => {
    expect(clampBandwidth(1)).toBe(1);
    expect(clampBandwidth(0)).toBe(0.05);
    expect(clampBandwidth(-5)).toBe(0.05);
    expect(clampBandwidth(NaN)).toBe(0.05);
  });
});

describe('clampLambda', () => {
  it('enforces a positive floor', () => {
    expect(clampLambda(0.1)).toBe(0.1);
    expect(clampLambda(0)).toBe(0.0001);
    expect(clampLambda(-1)).toBe(0.0001);
    expect(clampLambda(NaN)).toBe(0.0001);
  });
});

describe('clampNoiseSD', () => {
  it('clamps to [0, 5]', () => {
    expect(clampNoiseSD(1)).toBe(1);
    expect(clampNoiseSD(-1)).toBe(0);
    expect(clampNoiseSD(100)).toBe(5);
    expect(clampNoiseSD(NaN)).toBe(1);
  });
});

describe('clampReplicateCount', () => {
  it('clamps to [10, 1000] and rounds', () => {
    expect(clampReplicateCount(200)).toBe(200);
    expect(clampReplicateCount(5)).toBe(10);
    expect(clampReplicateCount(5000)).toBe(1000);
    expect(clampReplicateCount(50.6)).toBe(51);
    expect(clampReplicateCount(NaN)).toBe(200);
    expect(clampReplicateCount(Infinity)).toBe(200);
  });
});

describe('clampCoverageInnerReplicates', () => {
  it('clamps to [10, 100] and rounds', () => {
    expect(clampCoverageInnerReplicates(30)).toBe(30);
    expect(clampCoverageInnerReplicates(5)).toBe(10);
    expect(clampCoverageInnerReplicates(500)).toBe(100);
    expect(clampCoverageInnerReplicates(25.6)).toBe(26);
    expect(clampCoverageInnerReplicates(NaN)).toBe(30);
    expect(clampCoverageInnerReplicates(Infinity)).toBe(30);
  });
});
