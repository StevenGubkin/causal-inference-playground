// ARCHITECTURE.md §17 Phase 1: real sampling formulas. Normal, Bernoulli,
// Uniform, and Poisson are implemented so far (ARCHITECTURE.md §4.6 lists
// the rest for later).
import type { CompiledExpr, Distribution, NodeId, RNG } from 'scm-dsl';

const EPS_ALIASES = ['eps', 'epsilon', 'ε'] as const;

/** Evaluate an expression, drawing one fresh Normal(0, noiseSD) noise value
 * (shared across all three eps spellings) if it uses the implicit noise
 * term. `noiseSD` only scales the implicit `eps` term, never a node's own
 * declared `~ Dist(...)` parameters. */
export function evalWithNoise(expr: CompiledExpr, baseScope: Record<NodeId, number>, rng: RNG, noiseSD = 1): number {
  if (!expr.usesNoise) return expr.eval(baseScope);
  const noise = rng.normal() * noiseSD;
  const scope = { ...baseScope };
  for (const alias of EPS_ALIASES) scope[alias] = noise;
  return expr.eval(scope);
}

type SamplerFn = (params: number[], rng: RNG) => number;

const SAMPLERS: Record<string, SamplerFn> = {
  Normal: ([mean, sd], rng) => mean! + sd! * rng.normal(),
  Bernoulli: ([p], rng) => (rng.next() < p! ? 1 : 0),
  Uniform: ([a, b], rng) => a! + (b! - a!) * rng.next(),
  // Knuth's algorithm: multiply uniforms until the product drops below e^-lambda.
  Poisson: ([lambda], rng) => {
    const limit = Math.exp(-lambda!);
    let k = 0;
    let product = 1;
    do {
      k++;
      product *= rng.next();
    } while (product > limit);
    return k - 1;
  },
};

export function sampleDistribution(dist: Distribution, scope: Record<NodeId, number>, rng: RNG, noiseSD = 1): number {
  const sampler = SAMPLERS[dist.name];
  if (!sampler) {
    throw new Error(
      `no Phase 1 sampler registered for distribution "${dist.name}" yet ` +
        `(implemented so far: ${Object.keys(SAMPLERS).join(', ')})`,
    );
  }
  const paramValues = dist.params.map((param) => evalWithNoise(param, scope, rng, noiseSD));
  return sampler(paramValues, rng);
}
