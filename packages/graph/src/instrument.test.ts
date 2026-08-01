import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { instrumentValid } from './instrument.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('instrumentValid: iv-late.scm', () => {
  it('Z is a valid instrument for D -> Y', () => {
    const source = readFileSync(join(__dirname, '../../examples/models/iv-late.scm'), 'utf8');
    const result = parseModel(source);
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    expect(instrumentValid(result.model, 'D', 'Y', 'Z').ok).toBe(true);
  });
});

describe('instrumentValid: broken exclusion (inline fixture)', () => {
  it('rejects an instrument with a direct edge to the outcome', () => {
    const result = parseModel('Z ~ Bernoulli(0.5)\nX = Z + eps\nY = X + Z + eps');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const verdict = instrumentValid(result.model, 'X', 'Y', 'Z');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('exclusion');
  });
});

describe('instrumentValid: irrelevant instrument (inline fixture)', () => {
  it('rejects a candidate with no association with the treatment', () => {
    const result = parseModel('W ~ Normal(0, 1)\nX ~ Normal(0, 1)\nY = X + eps');
    if (!result.ok) throw new Error(JSON.stringify(result.errors));

    const verdict = instrumentValid(result.model, 'X', 'Y', 'W');
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('relevance');
  });
});
