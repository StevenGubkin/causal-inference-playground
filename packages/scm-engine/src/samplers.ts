// ARCHITECTURE.md §17 Phase 1: real sampling formulas. Only Normal and
// Bernoulli are implemented — the only distributions the current gallery
// presets use (ARCHITECTURE.md §4.6 lists the rest for later).
import type { CompiledExpr, Distribution, NodeId, RNG } from 'scm-dsl';

const EPS_ALIASES = ['eps', 'epsilon', 'ε'] as const;

/** Evaluate an expression, drawing one fresh Normal(0,1) noise value (shared
 * across all three eps spellings) if it uses the implicit noise term. */
export function evalWithNoise(expr: CompiledExpr, baseScope: Record<NodeId, number>, rng: RNG): number {
  if (!expr.usesNoise) return expr.eval(baseScope);
  const noise = rng.normal();
  const scope = { ...baseScope };
  for (const alias of EPS_ALIASES) scope[alias] = noise;
  return expr.eval(scope);
}

type SamplerFn = (params: number[], rng: RNG) => number;

const SAMPLERS: Record<string, SamplerFn> = {
  Normal: ([mean, sd], rng) => mean! + sd! * rng.normal(),
  Bernoulli: ([p], rng) => (rng.next() < p! ? 1 : 0),
};

export function sampleDistribution(dist: Distribution, scope: Record<NodeId, number>, rng: RNG): number {
  const sampler = SAMPLERS[dist.name];
  if (!sampler) {
    throw new Error(
      `no Phase 1 sampler registered for distribution "${dist.name}" yet ` +
        '(only Normal and Bernoulli are implemented so far)',
    );
  }
  const paramValues = dist.params.map((param) => evalWithNoise(param, scope, rng));
  return sampler(paramValues, rng);
}
