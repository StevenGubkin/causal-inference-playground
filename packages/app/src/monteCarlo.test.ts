import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import type { Model } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { runMonteCarloReplicate, summarizeReplicates } from './monteCarlo.js';
import type { MonteCarloConfig } from './monteCarlo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadModel(fixture: string): Model {
  const source = readFileSync(join(__dirname, '../../examples/models', fixture), 'utf8');
  const result = parseModel(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.model;
}

function baseConfig(model: Model, treatment: string, outcome: string): MonteCarloConfig {
  return {
    model,
    treatment,
    outcome,
    ateA: 0,
    ateB: 1,
    sampleSize: 500,
    noiseSD: 1,
    adjustment: [],
    basisMode: 'polynomial',
    degree: 1,
    bandwidth: 0.5,
    lambda: 0.01,
    instrument: '',
    mediator: '',
  };
}

function replicates(config: MonteCarloConfig, count: number) {
  const baseRng = createRNG(1).fork('mc-test');
  return Array.from({ length: count }, (_, i) => runMonteCarloReplicate(config, baseRng.fork(`mc-rep-${i}`)));
}

describe('summarizeReplicates', () => {
  it('computes bias and RMSE for a known array', () => {
    const summary = summarizeReplicates([1, 2, 3], 2);
    expect(summary.values).toEqual([1, 2, 3]);
    expect(summary.failures).toBe(0);
    expect(summary.bias).toBeCloseTo(0, 10);
    expect(summary.rmse).toBeCloseTo(Math.sqrt(2 / 3), 10);
  });

  it('excludes nulls from values and counts them as failures', () => {
    const summary = summarizeReplicates([1, null, 3, null], 2);
    expect(summary.values).toEqual([1, 3]);
    expect(summary.failures).toBe(2);
    expect(summary.bias).toBeCloseTo(0, 10);
  });

  it('returns NaN bias/RMSE and an empty values array when every replicate failed', () => {
    const summary = summarizeReplicates([null, null, null], 2);
    expect(summary.values).toEqual([]);
    expect(summary.failures).toBe(3);
    expect(summary.bias).toBeNaN();
    expect(summary.rmse).toBeNaN();
  });
});

describe('runMonteCarloReplicate: confounding.scm (continuous adjustment covariate)', () => {
  const model = loadModel('confounding.scm');
  const config = { ...baseConfig(model, 'X', 'Y'), adjustment: ['C'] };
  const reps = replicates(config, 20);

  it('naive and gcomp always succeed', () => {
    expect(reps.every((r) => r.naive !== null)).toBe(true);
    expect(reps.every((r) => r.gcomp !== null)).toBe(true);
  });

  it('stratify always fails -- continuous C trips the cardinality guard every replicate', () => {
    expect(reps.every((r) => r.stratify === null)).toBe(true);
  });

  it('gcomp is closer to the true effect (2.0) than naive on average', () => {
    const naiveMean = reps.reduce((s, r) => s + r.naive!, 0) / reps.length;
    const gcompMean = reps.reduce((s, r) => s + r.gcomp!, 0) / reps.length;
    expect(Math.abs(gcompMean - 2.0)).toBeLessThan(Math.abs(naiveMean - 2.0));
  });

  it('ipw/aipw/iv/frontdoor are skipped -- treatment is continuous, no instrument/mediator configured', () => {
    expect(reps.every((r) => r.ipw === null && r.aipw === null && r.iv === null && r.frontdoor === null)).toBe(true);
  });
});

describe('runMonteCarloReplicate: simpson.scm (discrete adjustment covariate)', () => {
  const model = loadModel('simpson.scm');
  const config = { ...baseConfig(model, 'X', 'Y'), adjustment: ['Z'] };
  const reps = replicates(config, 20);

  it('stratify succeeds on every replicate -- Z is genuinely discrete, so the cardinality guard never fires', () => {
    expect(reps.every((r) => r.stratify !== null)).toBe(true);
  });
});

describe('runMonteCarloReplicate: ipw-confounding.scm (binary treatment)', () => {
  const model = loadModel('ipw-confounding.scm');
  const config = { ...baseConfig(model, 'X', 'Y'), adjustment: ['Z'] };
  const reps = replicates(config, 20);

  it('ipw and aipw succeed on every replicate', () => {
    expect(reps.every((r) => r.ipw !== null)).toBe(true);
    expect(reps.every((r) => r.aipw !== null)).toBe(true);
  });

  it('stratify always fails -- Z is continuous here too', () => {
    expect(reps.every((r) => r.stratify === null)).toBe(true);
  });
});

describe('runMonteCarloReplicate: instrument/mediator gating', () => {
  it('iv2sls runs when an instrument is configured, and is skipped (null, not attempted) otherwise', () => {
    const model = loadModel('iv-late.scm');
    const withInstrument = replicates({ ...baseConfig(model, 'D', 'Y'), instrument: 'Z' }, 5);
    expect(withInstrument.every((r) => r.iv !== null)).toBe(true);

    const withoutInstrument = replicates(baseConfig(model, 'D', 'Y'), 5);
    expect(withoutInstrument.every((r) => r.iv === null)).toBe(true);
  });

  it('frontdoorDoseResponse runs when a mediator is configured, and is skipped otherwise', () => {
    const model = loadModel('frontdoor.scm');
    const withMediator = replicates({ ...baseConfig(model, 'X', 'Y'), mediator: 'M' }, 5);
    expect(withMediator.every((r) => r.frontdoor !== null)).toBe(true);

    const withoutMediator = replicates(baseConfig(model, 'X', 'Y'), 5);
    expect(withoutMediator.every((r) => r.frontdoor === null)).toBe(true);
  });
});
