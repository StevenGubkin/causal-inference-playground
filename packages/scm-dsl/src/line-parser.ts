// ARCHITECTURE.md §4.5: a hand-written line-level parser for the statement
// forms (~, =, latent, <->, noise); only RHS expressions and
// distribution-argument expressions are handed to mathjs. Purely syntactic
// — identifier resolution and the security allow-list are §4.8's job
// (validate.ts), since that needs the whole program's declared names.
import type { MathNode } from 'mathjs';
import type { DistributionSource, ExprSource, StatementAst } from './ast.js';
import type { DslError } from './errors.js';
import { math } from './math-instance.js';

const IDENT = '[A-Za-z][A-Za-z0-9_]*';
const NODE_DECL_RE = new RegExp(`^(${IDENT})\\s*=\\s*(.+)$`);
const STOCHASTIC_DECL_RE = new RegExp(`^(${IDENT})\\s*~\\s*(.+)$`);
const NOISE_DECL_RE = new RegExp(`^noise\\s+(${IDENT})\\s*~\\s*(.+)$`);
const BIDIRECTED_RE = new RegExp(`^(${IDENT})\\s*<->\\s*(${IDENT})$`);
const LATENT_PREFIX_RE = /^latent\s+(.+)$/;

export interface ParseStatementsResult {
  statements: StatementAst[];
  errors: DslError[];
}

export function parseStatements(source: string): ParseStatementsResult {
  const statements: StatementAst[] = [];
  const errors: DslError[] = [];
  const lines = source.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1;
    const text = lines[i]!.split('#')[0]!.trim();
    if (text.length === 0) continue;

    const latentMatch = text.match(LATENT_PREFIX_RE);
    const latent = latentMatch !== null;
    const body = latent ? latentMatch[1]!.trim() : text;

    const result = parseStatementBody(body, lineNumber, latent);
    if (isDslError(result)) {
      errors.push(result);
    } else {
      statements.push(result);
    }
  }

  return { statements, errors };
}

function isDslError<T>(value: T | DslError): value is DslError {
  return typeof value === 'object' && value !== null && 'message' in value;
}

function parseStatementBody(body: string, line: number, latent: boolean): StatementAst | DslError {
  const noiseMatch = body.match(NOISE_DECL_RE);
  if (noiseMatch) {
    if (latent) return { message: '"latent" cannot modify a noise declaration', line, kind: 'syntax' };
    const dist = parseDistribution(noiseMatch[2]!, line);
    if (isDslError(dist)) return dist;
    return { kind: 'noise', line, name: noiseMatch[1]!, dist };
  }

  const bidirectedMatch = body.match(BIDIRECTED_RE);
  if (bidirectedMatch) {
    if (latent) return { message: '"latent" cannot modify a <-> declaration', line, kind: 'syntax' };
    return { kind: 'bidirected', line, a: bidirectedMatch[1]!, b: bidirectedMatch[2]! };
  }

  const stochasticMatch = body.match(STOCHASTIC_DECL_RE);
  if (stochasticMatch) {
    const dist = parseDistribution(stochasticMatch[2]!, line);
    if (isDslError(dist)) return dist;
    return { kind: 'node', line, name: stochasticMatch[1]!, latent, form: 'stochastic', dist };
  }

  const nodeMatch = body.match(NODE_DECL_RE);
  if (nodeMatch) {
    const expr = parseExpr(nodeMatch[2]!, line);
    if (isDslError(expr)) return expr;
    return { kind: 'node', line, name: nodeMatch[1]!, latent, form: 'deterministic', expr };
  }

  return { message: `unrecognized statement: "${body}"`, line, kind: 'syntax' };
}

function parseExpr(text: string, line: number): ExprSource | DslError {
  const raw = text.trim();
  try {
    return { raw, node: math.parse(raw) };
  } catch (e) {
    return { message: `could not parse expression "${raw}": ${(e as Error).message}`, line, kind: 'syntax' };
  }
}

function parseDistribution(text: string, line: number): DistributionSource | DslError {
  const raw = text.trim();
  let node: MathNode;
  try {
    node = math.parse(raw);
  } catch (e) {
    return { message: `could not parse distribution "${raw}": ${(e as Error).message}`, line, kind: 'syntax' };
  }
  if (node.type !== 'FunctionNode') {
    return { message: `expected a distribution call like Normal(0, 1), got "${raw}"`, line, kind: 'syntax' };
  }
  const fnNode = node as unknown as { fn: { name: string }; args: MathNode[] };
  return {
    name: fnNode.fn.name,
    args: fnNode.args.map((argNode) => ({ raw: argNode.toString(), node: argNode })),
  };
}
