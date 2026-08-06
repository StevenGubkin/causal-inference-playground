import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG, forwardSample } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { computeCI, runBootstrapReplicate, runJackknifeReplicate } from './bootstrapCi.js';
import { computeEstimateSet } from './monteCarlo.js';
import type { EstimatorConfig } from './monteCarlo.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('computeCI: percentile', () => {
  it('matches a hand-computed percentile interval', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ci = computeCI('percentile', 3, values, 0, null);
    // idx = 0.025*9 = 0.225 -> 1 + (2-1)*0.225 = 1.225
    expect(ci.lower).toBeCloseTo(1.225, 6);
    // idx = 0.975*9 = 8.775 -> 9 + (10-9)*0.775 = 9.775
    expect(ci.upper).toBeCloseTo(9.775, 6);
    expect(ci.estimate).toBe(3);
    expect(ci.replicates).toBe(10);
  });

  it('returns null bounds with too few successful replicates', () => {
    const ci = computeCI('percentile', 3, [1, 2, 3, 4, 5], 2, null);
    expect(ci.lower).toBeNull();
    expect(ci.upper).toBeNull();
    expect(ci.replicates).toBe(5);
    expect(ci.failures).toBe(2);
  });
});

describe('computeCI: basic', () => {
  it('matches a hand-computed reflected interval, distinct from percentile when estimate is off-center', () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const ci = computeCI('basic', 3, values, 0, null);
    // lower = 2*3 - 9.775 = -3.775; upper = 2*3 - 1.225 = 4.775
    expect(ci.lower).toBeCloseTo(-3.775, 6);
    expect(ci.upper).toBeCloseTo(4.775, 6);
  });
});

describe('computeCI: bca', () => {
  it('reduces to percentile when z0=0 and a=0 (symmetric bootstrap and jackknife distributions)', () => {
    const bootstrapValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]; // symmetric around 5.5, exactly half below 5.5
    const jackknifeValues = [-3, -2, -1, 0, 1, 2, 3]; // symmetric around 0 -> zero third central moment
    const bca = computeCI('bca', 5.5, bootstrapValues, 0, jackknifeValues);
    const pct = computeCI('percentile', 5.5, bootstrapValues, 0, null);
    expect(bca.lower).toBeCloseTo(pct.lower!, 6);
    expect(bca.upper).toBeCloseTo(pct.upper!, 6);
  });

  it('falls back to percentile when jackknifeValues is null or too short', () => {
    const bootstrapValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const pct = computeCI('percentile', 5.5, bootstrapValues, 0, null);
    expect(computeCI('bca', 5.5, bootstrapValues, 0, null)).toEqual(pct);
    expect(computeCI('bca', 5.5, bootstrapValues, 0, [1, 2, 3])).toEqual(pct);
  });
});

describe('integration: confounding.scm, adjust {C}', () => {
  function load() {
    const source = readFileSync(join(__dirname, '../../examples/models/confounding.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    return result.model;
  }

  const model = load();
  const baseRng = createRNG(1);
  const observed = forwardSample(model, 500, baseRng, 1).observed();
  const config: EstimatorConfig = {
    treatment: 'X',
    outcome: 'Y',
    ateA: 0,
    ateB: 1,
    adjustment: ['C'],
    basisMode: 'polynomial',
    degree: 1,
    bandwidth: 0.5,
    lambda: 0.01,
    instrument: '',
    mediator: '',
  };
  const pointEstimate = computeEstimateSet(observed, config);

  const bootstrapBase = createRNG(2).fork('bootstrap');
  const bootstrapReplicates = Array.from({ length: 200 }, (_, i) => runBootstrapReplicate(observed, config, bootstrapBase.fork(`rep-${i}`)));
  const gcompBootstrap = bootstrapReplicates.map((r) => r.gcomp).filter((v): v is number => v !== null);
  const stratifyBootstrap = bootstrapReplicates.map((r) => r.stratify).filter((v): v is number => v !== null);

  const jackknifeReplicates = Array.from({ length: observed.n }, (_, i) => runJackknifeReplicate(observed, i, config));
  const gcompJackknife = jackknifeReplicates.map((r) => r.gcomp).filter((v): v is number => v !== null);

  it.each(['percentile', 'basic', 'bca'] as const)('%s: gcomp interval contains the true effect (2.0)', (method) => {
    const ci = computeCI(method, pointEstimate.gcomp!, gcompBootstrap, 0, gcompJackknife);
    expect(ci.lower).not.toBeNull();
    expect(ci.lower!).toBeLessThan(2.0);
    expect(ci.upper!).toBeGreaterThan(2.0);
  });

  it.each(['percentile', 'basic', 'bca'] as const)('%s: stratify falls back to null bounds -- continuous C trips the cardinality guard on nearly every resample', (method) => {
    const ci = computeCI(method, 0, stratifyBootstrap, bootstrapReplicates.length - stratifyBootstrap.length, null);
    expect(ci.lower).toBeNull();
    expect(ci.upper).toBeNull();
  });
});
