import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRNG, doContrast, forwardSample } from 'scm-engine';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { iv2sls } from './iv2sls.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden test: iv2sls on iv-late.scm recovers the LATE, not the population ATE', () => {
  it('matches the story METHODS.md\'s worked construction was built for', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/iv-late.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    const model = result.model;

    const sample = forwardSample(model, 20000, createRNG(2024));
    const observed = sample.observed();

    const iv = iv2sls(observed, 'D', 'Y', 'Z', [0, 1]);
    const late = iv.estimate;

    // Z is a strong instrument by construction -- first-stage F should be
    // large (conventionally, F < 10 is "weak").
    expect(iv.firstStageF).toBeGreaterThan(10);

    // The population ATE the oracle computes (do(D: 0 -> 1), averaging tau
    // over always-takers/compliers/never-takers) differs from the LATE
    // (compliers only, tauC=3 in the model) -- that divergence is the whole
    // point of the construction, so check it's real rather than asserting
    // an exact hand-derived number (the population type shares depend on
    // integrating the logistic-linked latent U, not worth deriving by hand).
    const trueAte = doContrast(model, 'D', 'Y', 0, 1, 4000, createRNG(99));
    expect(Math.abs(late - trueAte)).toBeGreaterThan(0.3);

    // LATE should land closer to the compliers' own effect (tauC=3) than
    // the population ATE does.
    expect(Math.abs(late - 3)).toBeLessThan(Math.abs(trueAte - 3));
  });
});
