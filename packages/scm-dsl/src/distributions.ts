// ARCHITECTURE.md §4.6 — Distributions (v1) and their arity/domain metadata,
// used by static validation (§4.8 rule 4). Actual sampling formulas are a
// Phase 1 deliverable (§17: "Phase 1 — Engine + oracle. Distributions,
// seeded RNG, ..."), so `sample()` on the compiled Distribution objects
// throws until scm-engine supplies real implementations.

export type Arity = number | { min: number; max: number };

export interface DistributionSpec {
  name: string;
  arity: Arity;
  /**
   * Domain check for the params that are constant numeric literals at parse
   * time. `undefined` entries are parent-dependent expressions, whose
   * domain is a runtime diagnostic, not a parse-time error (§4.8 rule 4).
   */
  checkConstantDomain(paramValues: (number | undefined)[]): string | null;
}

function arityMatches(arity: Arity, count: number): boolean {
  return typeof arity === 'number' ? count === arity : count >= arity.min && count <= arity.max;
}

function describeArity(arity: Arity): string {
  return typeof arity === 'number'
    ? `exactly ${arity} argument${arity === 1 ? '' : 's'}`
    : `between ${arity.min} and ${arity.max === Infinity ? 'unlimited' : arity.max} arguments`;
}

function positive(value: number | undefined, label: string): string | null {
  if (value === undefined) return null;
  return value > 0 ? null : `${label} must be > 0, got ${value}`;
}

function unitInterval(value: number | undefined, label: string): string | null {
  if (value === undefined) return null;
  return value >= 0 && value <= 1 ? null : `${label} must be in [0, 1], got ${value}`;
}

export const DISTRIBUTIONS: Record<string, DistributionSpec> = {
  Normal: {
    name: 'Normal',
    arity: 2,
    checkConstantDomain: ([, sd]) => positive(sd, 'Normal sd (2nd argument)'),
  },
  Bernoulli: {
    name: 'Bernoulli',
    arity: 1,
    checkConstantDomain: ([p]) => unitInterval(p, 'Bernoulli p'),
  },
  Uniform: {
    name: 'Uniform',
    arity: 2,
    checkConstantDomain: ([a, b]) =>
      a !== undefined && b !== undefined && a >= b ? `Uniform requires a < b, got a=${a}, b=${b}` : null,
  },
  Poisson: {
    name: 'Poisson',
    arity: 1,
    checkConstantDomain: ([lambda]) => positive(lambda, 'Poisson lambda'),
  },
  Binomial: {
    name: 'Binomial',
    arity: 2,
    checkConstantDomain: ([n, p]) => {
      if (n !== undefined && (!Number.isInteger(n) || n < 0)) {
        return `Binomial n must be a nonnegative integer, got ${n}`;
      }
      return unitInterval(p, 'Binomial p (2nd argument)');
    },
  },
  Categorical: {
    name: 'Categorical',
    arity: { min: 2, max: Infinity },
    checkConstantDomain: (paramValues) => {
      for (const [i, p] of paramValues.entries()) {
        const err = unitInterval(p, `Categorical p${i + 1}`);
        if (err) return err;
      }
      if (paramValues.every((p) => p !== undefined)) {
        const sum = paramValues.reduce((acc: number, p) => acc + (p ?? 0), 0);
        if (Math.abs(sum - 1) > 1e-6) {
          return `Categorical probabilities must sum to 1, got ${sum}`;
        }
      }
      return null;
    },
  },
  Exponential: {
    name: 'Exponential',
    arity: 1,
    checkConstantDomain: ([rate]) => positive(rate, 'Exponential rate'),
  },
  Gamma: {
    name: 'Gamma',
    arity: 2,
    checkConstantDomain: ([shape, rate]) => positive(shape, 'Gamma shape') ?? positive(rate, 'Gamma rate (2nd argument)'),
  },
  Beta: {
    name: 'Beta',
    arity: 2,
    checkConstantDomain: ([alpha, beta]) => positive(alpha, 'Beta alpha') ?? positive(beta, 'Beta beta (2nd argument)'),
  },
  LogNormal: {
    name: 'LogNormal',
    arity: 2,
    checkConstantDomain: ([, sigma]) => positive(sigma, 'LogNormal sigma (2nd argument)'),
  },
  PointMass: {
    name: 'PointMass',
    arity: 1,
    checkConstantDomain: () => null,
  },
};

export function getDistributionSpec(name: string): DistributionSpec | undefined {
  return DISTRIBUTIONS[name];
}

export function checkArity(spec: DistributionSpec, count: number): string | null {
  return arityMatches(spec.arity, count)
    ? null
    : `${spec.name} expects ${describeArity(spec.arity)}, got ${count}`;
}

export function notImplementedSample(): never {
  throw new Error(
    'Distribution sampling is a Phase 1 deliverable (ARCHITECTURE.md §17) — ' +
      'scm-dsl only parses, validates, and compiles the Model IR.',
  );
}
