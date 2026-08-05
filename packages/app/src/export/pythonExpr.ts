// ARCHITECTURE.md §12 "Export": generated runnable Python. Converts a
// parsed DSL expression (mathjs MathNode) into a numpy-array-valued Python
// expression string. Only walks the 5 node types math-instance.ts's
// security allow-list permits (ConstantNode, SymbolNode, FunctionNode,
// OperatorNode, ParenthesisNode) -- every other MathNode type is already
// rejected before a model can validate, so this doesn't need a fallback.
import type { MathNode } from 'mathjs';

// §4.7's exact allow-listed function surface, mapped to a numpy equivalent.
// logistic/sigmoid and step/indicator are semantically identical pairs
// (see math-instance.ts's own registration), so both spellings resolve to
// one shared helper -- see PYTHON_HELPERS below.
const FUNCTION_MAP: Record<string, (args: string[]) => string> = {
  exp: (a) => `np.exp(${a[0]})`,
  log: (a) => `np.log(${a[0]})`,
  sqrt: (a) => `np.sqrt(${a[0]})`,
  abs: (a) => `np.abs(${a[0]})`,
  sin: (a) => `np.sin(${a[0]})`,
  cos: (a) => `np.cos(${a[0]})`,
  min: (a) => `np.minimum(${a[0]}, ${a[1]})`,
  max: (a) => `np.maximum(${a[0]}, ${a[1]})`,
  clamp: (a) => `np.clip(${a[0]}, ${a[1]}, ${a[2]})`,
  logistic: (a) => `_logistic(${a[0]})`,
  sigmoid: (a) => `_logistic(${a[0]})`,
  step: (a) => `_step(${a[0]})`,
  indicator: (a) => `_step(${a[0]})`,
};

export const PYTHON_HELPERS = `def _logistic(x):
    # Numerically stable sigmoid, vectorized over numpy arrays: exp(-x)
    # overflows for very negative x, and exp(x) overflows for very positive
    # x, so each element is routed to whichever branch only ever exponentiates
    # a non-positive value. Boolean masking (not np.where) is required here --
    # np.where evaluates both branches for every element before selecting,
    # which would still overflow on the discarded branch.
    x = np.asarray(x, dtype=float)
    result = np.empty_like(x)
    pos = x >= 0
    neg = ~pos
    z_pos = np.exp(-x[pos])
    result[pos] = 1 / (1 + z_pos)
    z_neg = np.exp(x[neg])
    result[neg] = z_neg / (1 + z_neg)
    return result


def _step(x):
    return (x > 0).astype(float)
`;

const NOISE_NAMES = new Set(['eps', 'epsilon', 'ε']);

/** True if this expression references the DSL's implicit per-equation
 * noise term anywhere (any of the three spellings). */
export function usesNoiseSymbol(node: MathNode): boolean {
  let found = false;
  node.traverse((n: MathNode) => {
    if (n.type === 'SymbolNode' && NOISE_NAMES.has((n as unknown as { name: string }).name)) found = true;
  });
  return found;
}

/** Render `node` as a Python expression over numpy arrays. `noiseVar` is
 * the variable name standing in for this *statement's own* eps reference
 * (ARCHITECTURE.md §4.3 INVARIANT: two equations that each write eps get
 * independent noise -- so the caller must pass a fresh, per-statement name,
 * not a single global one). */
export function pyExpr(node: MathNode, noiseVar: string): string {
  switch (node.type) {
    case 'ConstantNode':
      return String((node as unknown as { value: unknown }).value);

    case 'SymbolNode': {
      const name = (node as unknown as { name: string }).name;
      return NOISE_NAMES.has(name) ? noiseVar : name;
    }

    case 'ParenthesisNode':
      // No extra wrapping needed: every OperatorNode below already
      // unconditionally parenthesizes itself, so the source's own explicit
      // parens are redundant here (this renderer is always maximally
      // parenthesized regardless).
      return pyExpr((node as unknown as { content: MathNode }).content, noiseVar);

    case 'OperatorNode': {
      const { op, args } = node as unknown as { op: string; args: MathNode[] };
      if (args.length === 1) return `(${op}${pyExpr(args[0]!, noiseVar)})`;
      const pyOp = op === '^' ? '**' : op;
      return `(${pyExpr(args[0]!, noiseVar)} ${pyOp} ${pyExpr(args[1]!, noiseVar)})`;
    }

    case 'FunctionNode': {
      const { fn, args } = node as unknown as { fn: { name: string }; args: MathNode[] };
      const pyArgs = args.map((a) => pyExpr(a, noiseVar));
      const mapped = FUNCTION_MAP[fn.name];
      if (!mapped) throw new Error(`no Python mapping registered for function "${fn.name}"`);
      return mapped(pyArgs);
    }

    default:
      // Unreachable for any model that passed scm-dsl validation -- the
      // security allow-list in math-instance.ts already rejects every
      // other MathNode type at parse time.
      throw new Error(`unsupported expression node type "${node.type}"`);
  }
}
