// ARCHITECTURE.md §4.7 (built-in functions) and §4.8 rule 6 (security
// boundary). Expressions can arrive from an untrusted permalink or iframe
// embed, so the allow-list walk below — not mathjs's own scope handling —
// is the thing that actually keeps evaluation safe. `math` itself is the
// standard full mathjs instance for convenience (parsing an AST is inert);
// nothing here trusts mathjs's default scoping to reject dangerous syntax.
import { all, create, type MathNode } from 'mathjs';

// mathjs's own .d.ts destructures `all` from a `Record<string,
// FactoryFunctionMap>`, which noUncheckedIndexedAccess types as possibly
// undefined even though it's always present at runtime.
export const math = create(all!, { predictable: true });

// logistic/sigmoid/step/indicator/clamp aren't mathjs builtins; register
// them so §4.7's function list is actually callable. `override: false`
// means this throws instead of silently shadowing a real mathjs function
// if a name ever collides.
math.import(
  {
    logistic: (x: number) => 1 / (1 + Math.exp(-x)),
    sigmoid: (x: number) => 1 / (1 + Math.exp(-x)),
    step: (x: number) => (x > 0 ? 1 : 0),
    indicator: (x: number) => (x > 0 ? 1 : 0),
    clamp: (x: number, lo: number, hi: number) => Math.min(Math.max(x, lo), hi),
  },
  { override: false },
);

// The exact §4.7 surface, plus the internal operator-function names mathjs
// compiles infix arithmetic down to (OperatorNode.fn / FunctionNode.fn.name)
// — both are checked against this one set.
export const ALLOWED_FUNCTIONS = new Set([
  'logistic',
  'sigmoid',
  'exp',
  'log',
  'sqrt',
  'abs',
  'sin',
  'cos',
  'min',
  'max',
  'step',
  'indicator',
  'clamp',
  'add',
  'subtract',
  'multiply',
  'divide',
  'pow',
  'unaryMinus',
  'unaryPlus',
  'mod',
]);

// Default-deny by AST node type: only what the §4.5 grammar's `expr`
// production actually needs. Everything else (AccessorNode, IndexNode,
// FunctionAssignmentNode, ObjectNode, ArrayNode, ConditionalNode,
// RelationalNode, AssignmentNode, BlockNode, RangeNode, ...) is rejected
// without needing to enumerate every dangerous construct by name.
const ALLOWED_NODE_TYPES = new Set(['ConstantNode', 'SymbolNode', 'FunctionNode', 'OperatorNode', 'ParenthesisNode']);

export interface DisallowedUse {
  message: string;
}

/**
 * Walk a parsed expression and reject anything outside the DSL's actual
 * surface: disallowed syntax forms, unknown functions, or identifiers that
 * don't resolve to a declared node/noise term (checked against
 * `allowedIdentifiers`, which the caller builds from the whole program —
 * see validate.ts rule 1/6). Returns the first violation found, or null.
 */
export function findDisallowedNode(node: MathNode, allowedIdentifiers: ReadonlySet<string>): DisallowedUse | null {
  let found: DisallowedUse | null = null;

  node.traverse((n: MathNode) => {
    if (found) return;

    if (!ALLOWED_NODE_TYPES.has(n.type)) {
      found = { message: `disallowed syntax in expression: ${n.type}` };
      return;
    }

    if (n.type === 'OperatorNode') {
      const fnName = (n as unknown as { fn?: string }).fn;
      if (!fnName || !ALLOWED_FUNCTIONS.has(fnName)) {
        found = { message: `disallowed operator "${fnName ?? '?'}"` };
      }
      return;
    }

    if (n.type === 'FunctionNode') {
      const fnName = (n as unknown as { fn?: { name?: string } }).fn?.name;
      if (!fnName || !ALLOWED_FUNCTIONS.has(fnName)) {
        found = { message: `unknown or disallowed function "${fnName ?? '?'}"` };
      }
      return;
    }

    if (n.type === 'SymbolNode') {
      const name = (n as unknown as { name: string }).name;
      if (!allowedIdentifiers.has(name) && !ALLOWED_FUNCTIONS.has(name)) {
        found = { message: `unresolved identifier "${name}"` };
      }
    }
  });

  return found;
}
