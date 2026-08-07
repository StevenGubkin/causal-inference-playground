import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { runCoverageReplicate, summarizeCoverage } from './coverageCheck.js';
import type { MonteCarloConfig } from './monteCarlo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('summarizeCoverage', () => {
  it('counts covered/attempted and computes the rate against a known trueValue', () => {
    const cis = [
      { estimate: 2, lower: 1, upper: 3, replicates: 30, failures: 0 }, // covers 2.0
      { estimate: 5, lower: 4, upper: 6, replicates: 30, failures: 0 }, // does not cover 2.0
      { estimate: 2.1, lower: 1.5, upper: 2.5, replicates: 30, failures: 0 }, // covers 2.0
    ];
    const summary = summarizeCoverage(cis, 2.0);
    expect(summary.attempted).toBe(3);
    expect(summary.covered).toBe(2);
    expect(summary.rate).toBeCloseTo(2 / 3, 10);
  });

  it('returns NaN rate when no CI was computable, but still counts attempted', () => {
    const cis = [
      { estimate: 2, lower: null, upper: null, replicates: 3, failures: 27 },
      { estimate: 2, lower: null, upper: null, replicates: 5, failures: 25 },
    ];
    const summary = summarizeCoverage(cis, 2.0);
    expect(summary.attempted).toBe(2);
    expect(summary.covered).toBe(0);
    expect(summary.rate).toBeNaN();
  });

  it('excludes null entries (estimator not active for that replicate) from attempted', () => {
    const cis = [null, { estimate: 2, lower: 1, upper: 3, replicates: 30, failures: 0 }, null];
    const summary = summarizeCoverage(cis, 2.0);
    expect(summary.attempted).toBe(1);
    expect(summary.covered).toBe(1);
    expect(summary.rate).toBe(1);
  });

  it('excludes uncomputable CIs from the rate denominator without dropping them from attempted', () => {
    const cis = [
      { estimate: 2, lower: 1, upper: 3, replicates: 30, failures: 0 }, // covers
      { estimate: 2, lower: null, upper: null, replicates: 3, failures: 27 }, // uncomputable
    ];
    const summary = summarizeCoverage(cis, 2.0);
    expect(summary.attempted).toBe(2);
    expect(summary.rate).toBe(1); // 1 covered out of 1 *computable* CI, not 2
  });
});

describe('runCoverageReplicate: confounding.scm (adjust {C})', () => {
  function load() {
    const source = readFileSync(join(__dirname, '../../examples/models/confounding.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.model;
  }

  const model = load();
  const config: MonteCarloConfig = {
    model,
    treatment: 'X',
    outcome: 'Y',
    ateA: 0,
    ateB: 1,
    sampleSize: 500,
    noiseSD: 1,
    adjustment: ['C'],
    basisMode: 'polynomial',
    degree: 1,
    bandwidth: 0.5,
    lambda: 0.01,
    instrument: '',
    mediator: '',
  };

  const R = 60;
  const innerReplicates = 30;
  const baseRng = createRNG(1).fork('coverage-test');
  const replicates = Array.from({ length: R }, (_, i) => runCoverageReplicate(config, 'percentile', innerReplicates, baseRng.fork(`rep-${i}`)));

  it('gcomp coverage lands near the nominal 95% (well-specified estimator)', () => {
    const summary = summarizeCoverage(
      replicates.map((r) => r.cis.gcomp ?? null),
      2.0, // documented true effect
    );
    expect(summary.rate).toBeGreaterThan(0.7);
    expect(summary.rate).toBeLessThanOrEqual(1.0);
  });

  it('naive coverage is substantially below nominal -- confidently wrong, per METHODS.md', () => {
    const summary = summarizeCoverage(
      replicates.map((r) => r.cis.naive ?? null),
      2.0,
    );
    expect(summary.rate).toBeLessThan(0.5);
  });

  it('stratify is uncomputable throughout -- continuous C trips the cardinality guard on nearly every resample', () => {
    const summary = summarizeCoverage(
      replicates.map((r) => r.cis.stratify ?? null),
      2.0,
    );
    expect(Number.isNaN(summary.rate)).toBe(true);
  });
});
