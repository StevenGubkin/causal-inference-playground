import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { testableImplications } from './testable-implications.js';

function parse(source: string) {
  const result = parseModel(source);
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.model;
}

describe('testableImplications: chain A -> B -> C', () => {
  const model = parse('A ~ Normal(0, 1)\nB = A + eps\nC = B + eps');

  it('finds exactly one statement: A _||_ C | {B} -- the only non-adjacent pair', () => {
    const statements = testableImplications(model);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toEqual({ x: 'A', y: 'C', given: ['B'] });
  });
});

describe('testableImplications: confounding.scm (all pairs adjacent)', () => {
  // C~N(0,1); X=1.5C+eps; Y=2X+3C+eps -- every pair of observed nodes is
  // directly connected, so there are no non-adjacent pairs and thus no
  // testable CI statements at all.
  const model = parse('C ~ Normal(0, 1)\nX = 1.5*C + eps\nY = 2*X + 3*C + eps');

  it('returns an empty array', () => {
    expect(testableImplications(model)).toEqual([]);
  });
});

describe('testableImplications: M-bias (inline fixture, matches backdoor.test.ts)', () => {
  // latent U1~N(0,1); latent U2~N(0,1); X=U1+eps; Y=X+U2+eps; M=U1+U2+eps.
  // X,Y are adjacent (skipped). The two non-adjacent pairs -- (X,M) and
  // (Y,M) -- are each connected only through a fork over a *latent* common
  // cause (X<-U1->M, and Y<-U2->M respectively): forks stay open unless the
  // shared cause itself is conditioned on, and U1/U2 are never eligible
  // (latent, excluded from the observed candidate set). So neither pair has
  // *any* separating set among {X,Y,M} -- both are omitted, not an error.
  // This is the defining structural property of M-bias: none of the three
  // observed variables are independent of each other, marginally or
  // conditionally, at any observed conditioning set.
  const model = parse('latent U1 ~ Normal(0, 1)\nlatent U2 ~ Normal(0, 1)\nX = U1 + eps\nY = X + U2 + eps\nM = U1 + U2 + eps');

  it('returns an empty array -- no observed pair has a valid separating set', () => {
    expect(testableImplications(model)).toEqual([]);
  });
});
