import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModel } from 'scm-dsl';
import type { Model } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { backdoorValid, findBackdoorSet } from './backdoor.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadModel(name: string): Model {
  const source = readFileSync(join(__dirname, '../../examples/models', name), 'utf8');
  const result = parseModel(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.model;
}

describe('backdoorValid: confounding.scm', () => {
  const model = loadModel('confounding.scm');

  it('{} is invalid -- C confounds X and Y', () => {
    expect(backdoorValid(model, 'X', 'Y', new Set()).ok).toBe(false);
  });

  it('{C} is a valid backdoor set', () => {
    expect(backdoorValid(model, 'X', 'Y', new Set(['C'])).ok).toBe(true);
  });
});

describe('backdoorValid: collider.scm', () => {
  const model = loadModel('collider.scm');

  it('{S} is invalid -- S is a descendant of X (the simple descendant-exclusion rule)', () => {
    const result = backdoorValid(model, 'X', 'Y', new Set(['S']));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('descendant');
  });

  it('{} is valid -- X and Y are independent without conditioning on the collider', () => {
    expect(backdoorValid(model, 'X', 'Y', new Set()).ok).toBe(true);
  });
});

describe('backdoorValid: mediator.scm', () => {
  const model = loadModel('mediator.scm');

  it('{M} is invalid -- M is a descendant of X', () => {
    expect(backdoorValid(model, 'X', 'Y', new Set(['M'])).ok).toBe(false);
  });

  it('{} is valid -- no confounding to begin with', () => {
    expect(backdoorValid(model, 'X', 'Y', new Set()).ok).toBe(true);
  });
});

describe('backdoorValid: M-bias (inline fixture, not a committed preset)', () => {
  // M is a collider between two independent latent causes (one of X, one of
  // Y) and is NOT a descendant of X -- so unlike collider.scm, only the
  // moralization/d-separation logic (not the cheap descendant check) can
  // catch this. The direct X->Y edge only exists so the model has a valid
  // treatment/outcome pair (§4.8 rule 5); it doesn't affect the M-bias
  // structure being tested, since backdoorValid mutilates X's out-edges
  // before checking for backdoor paths.
  const parsed = parseModel('latent U1 ~ Normal(0, 1)\nlatent U2 ~ Normal(0, 1)\nX = U1 + eps\nY = X + U2 + eps\nM = U1 + U2 + eps');
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));
  const model = parsed.model;

  it('{} is valid -- no backdoor confounding without conditioning on the collider (the defining feature of M-bias)', () => {
    expect(backdoorValid(model, 'X', 'Y', new Set()).ok).toBe(true);
  });

  it('{M} is invalid -- conditioning on the collider M opens the spurious U1-M-U2 path', () => {
    const result = backdoorValid(model, 'X', 'Y', new Set(['M']));
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('open backdoor path');
  });
});

describe('findBackdoorSet', () => {
  it('finds {C} for confounding.scm', () => {
    const model = loadModel('confounding.scm');
    expect(findBackdoorSet(model, 'X', 'Y')).toEqual(['C']);
  });

  it('finds {} for mediator.scm (no adjustment needed)', () => {
    const model = loadModel('mediator.scm');
    expect(findBackdoorSet(model, 'X', 'Y')).toEqual([]);
  });
});
