// Phase 0 (ARCHITECTURE.md §17): line-grammar + mathjs expressions, static
// validation (§4.8), producing a validated `Model` IR or typed errors.
export type { DistributionSource, ExprSource, StatementAst } from './ast.js';
export { DISTRIBUTIONS, getDistributionSpec } from './distributions.js';
export type { DistributionSpec } from './distributions.js';
export type { DslError } from './errors.js';
export { parseStatements } from './line-parser.js';
export type {
  CompiledExpr,
  Distribution,
  Model,
  Node,
  NodeId,
  NodeKind,
  RNG,
  RNGState,
  Visibility,
} from './model.js';
export { validate } from './validate.js';

import type { DslError } from './errors.js';
import { parseStatements } from './line-parser.js';
import type { Model } from './model.js';
import { validate } from './validate.js';

export type ParseModelResult = { ok: true; model: Model } | { ok: false; errors: DslError[] };

/** Parse and validate DSL source text into a Model IR, or typed errors. */
export function parseModel(source: string): ParseModelResult {
  const { statements, errors: syntaxErrors } = parseStatements(source);
  if (syntaxErrors.length > 0) {
    return { ok: false, errors: syntaxErrors };
  }
  const result = validate(statements);
  return Array.isArray(result) ? { ok: false, errors: result } : { ok: true, model: result };
}
