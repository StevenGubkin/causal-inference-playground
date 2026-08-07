// ARCHITECTURE.md §17 Phase 1: real sampling formulas for every v1
// distribution in ARCHITECTURE.md §4.6, except PointMass -- deliberately:
// see the comment above the SAMPLERS table.
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

// rng.next() can (rarely, but really) return exactly 0, which breaks
// Math.log(0) = -Infinity in the inverse-CDF/acceptance formulas below --
// the same reason Mulberry32RNG.normal() itself already guards against 0
// internally for Box-Muller.
function nonZeroUniform(rng: RNG): number {
  let u = 0;
  while (u === 0) u = rng.next();
  return u;
}

// Marsaglia & Tsang (2000), "A Simple Method for Generating Gamma Variables".
// Produces a Gamma(shape, rate) draw directly for shape >= 1; for shape < 1,
// boosted via Gamma(shape) = Gamma(shape+1) * U^(1/shape) in distribution
// (recursion depth is always exactly 1, since shape+1 >= 1 immediately).
function sampleGamma(shape: number, rate: number, rng: RNG): number {
  if (shape < 1) {
    const boosted = sampleGamma(shape + 1, 1, rng);
    return (boosted * Math.pow(nonZeroUniform(rng), 1 / shape)) / rate;
  }
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = rng.normal();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = nonZeroUniform(rng);
    if (Math.log(u) < 0.5 * x * x + d - d * v + d * Math.log(v)) {
      return (d * v) / rate;
    }
  }
}

// Distribution.name -> sampler. PointMass is deliberately not registered
// here: ARCHITECTURE.md §6 specs deterministic (`=`) nodes as "internally a
// PointMass distribution," but forwardSample never actually built it that
// way -- deterministic nodes go straight through evalWithNoise below, never
// through sampleDistribution/SAMPLERS at all, and PointMass isn't reachable
// via user-authored `~` syntax either. Registering it here would just be
// unreachable dead code; the underlying spec-vs-implementation gap is
// already tracked in REMAINING.md's Technical debt section.
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
  // Sum of n independent Bernoulli(p) draws -- same primitive as the
  // Bernoulli sampler above, just looped.
  Binomial: ([n, p], rng) => {
    let successes = 0;
    for (let i = 0; i < n!; i++) if (rng.next() < p!) successes++;
    return successes;
  },
  // 0-indexed: returns 0..params.length-1 (no existing usage anywhere in
  // the repo pins down the convention, so this is the natural choice --
  // consistent with Binomial/Poisson already returning plain counts usable
  // directly in arithmetic expressions). Cumulative-probability walk: draw
  // one uniform, return the first index where the running sum of p_i
  // exceeds it. The final fallback handles floating-point summation
  // leaving the cumulative sum just barely short of the drawn uniform.
  Categorical: (params, rng) => {
    const u = rng.next();
    let cumulative = 0;
    for (let i = 0; i < params.length; i++) {
      cumulative += params[i]!;
      if (u < cumulative) return i;
    }
    return params.length - 1;
  },
  // Inverse-CDF: -ln(U)/rate.
  Exponential: ([rate], rng) => -Math.log(nonZeroUniform(rng)) / rate!,
  Gamma: ([shape, rate], rng) => sampleGamma(shape!, rate!, rng),
  // Standard Gamma-ratio construction: X ~ Gamma(alpha,1), Y ~ Gamma(beta,1),
  // Beta = X/(X+Y).
  Beta: ([alpha, beta], rng) => {
    const x = sampleGamma(alpha!, 1, rng);
    const y = sampleGamma(beta!, 1, rng);
    return x / (x + y);
  },
  LogNormal: ([mu, sigma], rng) => Math.exp(mu! + sigma! * rng.normal()),
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
