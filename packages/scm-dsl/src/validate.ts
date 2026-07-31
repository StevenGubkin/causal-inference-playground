// ARCHITECTURE.md §4.8 — static validation. Turns parsed statements into a
// validated Model IR, or a list of typed, author-facing errors. Rules are
// numbered to match §4.8 exactly (as amended during design review: rule 6
// is the security allow-list, rule 7 is the noise budget).
import type { MathNode } from 'mathjs';
import type { DistributionSource, StatementAst } from './ast.js';
import { checkArity, getDistributionSpec, notImplementedSample } from './distributions.js';
import type { DslError } from './errors.js';
import { findDisallowedNode } from './math-instance.js';
import { buildModel, type CompiledExpr, type Distribution, type Model, type Node, type NodeId } from './model.js';

const EPS_ALIASES = new Set(['eps', 'epsilon', 'ε']);

type NodeStmt = Extract<StatementAst, { kind: 'node' }>;
type NoiseStmt = Extract<StatementAst, { kind: 'noise' }>;
type CovStmt = Extract<StatementAst, { kind: 'cov' }>;
type BiStmt = Extract<StatementAst, { kind: 'bidirected' }>;

export function validate(statements: StatementAst[]): Model | DslError[] {
  const errors: DslError[] = [];

  const nodeStmts = new Map<string, NodeStmt>();
  const noiseStmts = new Map<string, NoiseStmt>();
  const covDecls: CovStmt[] = [];
  const biDecls: BiStmt[] = [];

  for (const stmt of statements) {
    if (stmt.kind === 'node') {
      if (nodeStmts.has(stmt.name) || noiseStmts.has(stmt.name)) {
        errors.push({ message: `"${stmt.name}" is declared more than once`, line: stmt.line, kind: 'validation' });
        continue;
      }
      nodeStmts.set(stmt.name, stmt);
    } else if (stmt.kind === 'noise') {
      if (nodeStmts.has(stmt.name) || noiseStmts.has(stmt.name)) {
        errors.push({ message: `"${stmt.name}" is declared more than once`, line: stmt.line, kind: 'validation' });
        continue;
      }
      noiseStmts.set(stmt.name, stmt);
    } else if (stmt.kind === 'cov') {
      covDecls.push(stmt);
    } else {
      biDecls.push(stmt);
    }
  }

  // Rule 1 + Rule 6 (security boundary): every identifier/function used in
  // any expression must resolve to a declared node, noise term, the
  // implicit-noise aliases, or a §4.7 built-in — enforced as an allow-list
  // walk over the parsed AST, independent of mathjs's own scope handling.
  const allowedIdentifiers = new Set<string>([...nodeStmts.keys(), ...noiseStmts.keys(), ...EPS_ALIASES]);
  for (const stmt of statements) {
    for (const exprNode of collectExprNodes(stmt)) {
      const violation = findDisallowedNode(exprNode, allowedIdentifiers);
      if (violation) {
        errors.push({ message: violation.message, line: stmt.line, kind: 'validation' });
      }
    }
  }

  for (const decl of covDecls) {
    for (const name of [decl.a, decl.b]) {
      if (!nodeStmts.has(name)) {
        errors.push({ message: `cov() refers to undeclared node "${name}"`, line: decl.line, kind: 'validation' });
      }
    }
  }
  for (const decl of biDecls) {
    for (const name of [decl.a, decl.b]) {
      if (!nodeStmts.has(name)) {
        errors.push({ message: `<-> refers to undeclared node "${name}"`, line: decl.line, kind: 'validation' });
      }
    }
  }

  if (errors.length > 0) return errors; // later rules assume clean identifiers

  // Rule 4: distribution arity/domain sanity for constant params;
  // parent-dependent params are a runtime diagnostic, not a parse-time one.
  for (const stmt of statements) {
    if (stmt.kind === 'node' && stmt.form === 'stochastic') {
      errors.push(...checkDistribution(stmt.dist, stmt.line));
    } else if (stmt.kind === 'noise') {
      errors.push(...checkDistribution(stmt.dist, stmt.line));
    }
  }
  if (errors.length > 0) return errors;

  // Graph structure: parents (declared identifiers only — the eps aliases
  // are not declared identifiers and are excluded, per rule 2), plus the
  // synthetic latents that §4.3/§4.4 sugar adds.
  const declaredNames = new Set<string>([...nodeStmts.keys(), ...noiseStmts.keys()]);
  const parentsByName = new Map<string, Set<string>>();
  for (const name of declaredNames) parentsByName.set(name, new Set());

  for (const [name, stmt] of nodeStmts) {
    for (const exprNode of collectExprNodes(stmt)) {
      for (const parent of declaredParentsOf(exprNode, declaredNames)) {
        parentsByName.get(name)!.add(parent);
      }
    }
  }
  for (const [name, stmt] of noiseStmts) {
    for (const exprNode of collectExprNodes(stmt)) {
      for (const parent of declaredParentsOf(exprNode, declaredNames)) {
        parentsByName.get(name)!.add(parent);
      }
    }
  }

  const syntheticLatents: string[] = [];
  for (const decl of biDecls) {
    const id = freshId(`U_${decl.a}_${decl.b}`, declaredNames);
    declaredNames.add(id);
    parentsByName.set(id, new Set());
    parentsByName.get(decl.a)!.add(id);
    parentsByName.get(decl.b)!.add(id);
    syntheticLatents.push(id);
  }
  for (const decl of covDecls) {
    const id = freshId(`U_cov_${decl.a}_${decl.b}`, declaredNames);
    declaredNames.add(id);
    parentsByName.set(id, new Set());
    parentsByName.get(decl.a)!.add(id);
    parentsByName.get(decl.b)!.add(id);
    syntheticLatents.push(id);
  }

  // Rule 7: noise budget for cov() declarations (symmetric-loading
  // convention — see ARCHITECTURE.md §4.3/§4.8 rule 7). <-> needs no check:
  // it always adds a *fresh* independent latent, never borrowing variance
  // from a node's existing noise.
  errors.push(...checkNoiseBudget(covDecls, nodeStmts, noiseStmts));
  if (errors.length > 0) return errors;

  // Rule 3: acyclic. DFS instead of a literal Kahn's pass, chosen because
  // it directly yields the offending path for the error message.
  const cycle = findCycle(parentsByName);
  if (cycle) {
    errors.push({ message: `cycle detected: ${cycle.join(' -> ')}`, kind: 'validation' });
    return errors;
  }
  const topoOrder = topologicalOrder(parentsByName);

  // Rule 5: at least one valid treatment and outcome — two distinct
  // observed nodes connected by a directed path.
  const observedNames = new Set<string>();
  for (const [name, stmt] of nodeStmts) {
    if (!stmt.latent) observedNames.add(name);
  }
  if (!hasObservedCausalPair(observedNames, parentsByName)) {
    errors.push({
      message: 'no valid treatment/outcome pair: need at least two observed nodes connected by a directed path',
      kind: 'validation',
    });
    return errors;
  }

  // Compile the Model. `parentsByName` is authoritative for Node.parents —
  // it includes the synthetic cov()/<-> latents that a node's own raw
  // expression never mentions by name.
  const nodes = new Map<NodeId, Node>();
  for (const [name, stmt] of nodeStmts) {
    nodes.set(name, compileNode(name, stmt, declaredNames, parentsByName.get(name)!));
  }
  for (const [name, stmt] of noiseStmts) {
    nodes.set(name, compileNoiseNode(name, stmt, declaredNames, parentsByName.get(name)!));
  }
  for (const id of syntheticLatents) {
    nodes.set(id, compileSyntheticLatent(id));
  }

  const noise = new Map<string, { id: string; dist: Distribution }>();
  for (const name of noiseStmts.keys()) {
    noise.set(name, { id: name, dist: nodes.get(name)!.dist! });
  }

  return buildModel(nodes, noise, topoOrder);
}

// ---- expression helpers -----------------------------------------------

function collectExprNodes(stmt: StatementAst): MathNode[] {
  switch (stmt.kind) {
    case 'node':
      return stmt.form === 'deterministic' ? [stmt.expr.node] : stmt.dist.args.map((a) => a.node);
    case 'noise':
      return stmt.dist.args.map((a) => a.node);
    default:
      return [];
  }
}

function collectSymbolNames(node: MathNode): string[] {
  const names: string[] = [];
  node.traverse((n: MathNode) => {
    if (n.type === 'SymbolNode') {
      names.push((n as unknown as { name: string }).name);
    }
  });
  return names;
}

function declaredParentsOf(exprNode: MathNode, declaredNames: ReadonlySet<string>): string[] {
  return [...new Set(collectSymbolNames(exprNode).filter((n) => declaredNames.has(n)))];
}

function usesEpsAlias(exprNode: MathNode): boolean {
  return collectSymbolNames(exprNode).some((n) => EPS_ALIASES.has(n));
}

function evalConstant(node: MathNode): number | undefined {
  try {
    const result = node.compile().evaluate({});
    return typeof result === 'number' && Number.isFinite(result) ? result : undefined;
  } catch {
    return undefined;
  }
}

function freshId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// ---- rule 4: distribution arity/domain ---------------------------------

function checkDistribution(dist: DistributionSource, line: number): DslError[] {
  const spec = getDistributionSpec(dist.name);
  if (!spec) {
    return [{ message: `unknown distribution "${dist.name}"`, line, kind: 'validation' }];
  }
  const arityError = checkArity(spec, dist.args.length);
  if (arityError) {
    return [{ message: arityError, line, kind: 'validation' }];
  }
  const constValues = dist.args.map((arg) => evalConstant(arg.node));
  const domainError = spec.checkConstantDomain(constValues);
  return domainError ? [{ message: `${dist.name}: ${domainError}`, line, kind: 'validation' }] : [];
}

// ---- rule 7: noise budget -----------------------------------------------

type NoiseVarianceResult = { variance: number } | { error: string };

function resolveNodeNoiseVariance(name: string, nodeStmts: Map<string, NodeStmt>, noiseStmts: Map<string, NoiseStmt>): NoiseVarianceResult {
  const nodeStmt = nodeStmts.get(name);
  if (nodeStmt) {
    if (nodeStmt.form === 'stochastic') {
      if (nodeStmt.dist.name !== 'Normal') {
        return { error: `cov()/<-> requires "${name}" to have Normal noise (it is ~ ${nodeStmt.dist.name}(...))` };
      }
      const sd = evalConstant(nodeStmt.dist.args[1]!.node);
      if (sd === undefined) {
        return { error: `cov()/<-> requires "${name}"'s Normal sd to be a constant literal` };
      }
      return { variance: sd * sd };
    }
    const names = collectSymbolNames(nodeStmt.expr.node);
    const usesEps = names.some((n) => EPS_ALIASES.has(n));
    const namedNoiseRefs = names.filter((n) => noiseStmts.has(n));
    if (usesEps && namedNoiseRefs.length > 0) {
      return { error: `"${name}" mixes implicit "eps" noise with a named noise term; cov()/<-> needs one unambiguous noise source` };
    }
    if (usesEps) return { variance: 1 };
    if (namedNoiseRefs.length > 1) {
      return { error: `"${name}" references multiple named noise terms; cov()/<-> needs one unambiguous noise source` };
    }
    if (namedNoiseRefs.length === 1) {
      return resolveNoiseTermVariance(namedNoiseRefs[0]!, noiseStmts);
    }
    return { error: `"${name}" has no noise term ("eps" or a named noise reference) for cov()/<-> to act on` };
  }
  return { error: `"${name}" is not a declared node` };
}

function resolveNoiseTermVariance(name: string, noiseStmts: Map<string, NoiseStmt>): NoiseVarianceResult {
  const stmt = noiseStmts.get(name);
  if (!stmt) return { error: `"${name}" is not a declared noise term` };
  if (stmt.dist.name !== 'Normal') {
    return { error: `cov()/<-> requires noise term "${name}" to be Normal (it is ${stmt.dist.name}(...))` };
  }
  const sd = evalConstant(stmt.dist.args[1]!.node);
  if (sd === undefined) {
    return { error: `cov()/<-> requires noise term "${name}"'s sd to be a constant literal` };
  }
  return { variance: sd * sd };
}

function checkNoiseBudget(covDecls: CovStmt[], nodeStmts: Map<string, NodeStmt>, noiseStmts: Map<string, NoiseStmt>): DslError[] {
  const errors: DslError[] = [];
  const budgetUsed = new Map<string, number>();
  const firstLineFor = new Map<string, number>();

  for (const decl of covDecls) {
    const varA = resolveNodeNoiseVariance(decl.a, nodeStmts, noiseStmts);
    const varB = resolveNodeNoiseVariance(decl.b, nodeStmts, noiseStmts);
    if ('error' in varA) {
      errors.push({ message: varA.error, line: decl.line, kind: 'validation' });
      continue;
    }
    if ('error' in varB) {
      errors.push({ message: varB.error, line: decl.line, kind: 'validation' });
      continue;
    }

    const bound = Math.sqrt(varA.variance * varB.variance);
    if (Math.abs(decl.value) > bound + 1e-9) {
      errors.push({
        message: `cov(${decl.a}, ${decl.b}) = ${decl.value} is outside the valid range [-${bound.toFixed(4)}, ${bound.toFixed(4)}] given their declared noise variances`,
        line: decl.line,
        kind: 'validation',
      });
      continue;
    }

    for (const name of [decl.a, decl.b]) {
      budgetUsed.set(name, (budgetUsed.get(name) ?? 0) + Math.abs(decl.value));
      if (!firstLineFor.has(name)) firstLineFor.set(name, decl.line);
    }
  }

  for (const [name, used] of budgetUsed) {
    const info = resolveNodeNoiseVariance(name, nodeStmts, noiseStmts);
    if ('variance' in info && used > info.variance + 1e-9) {
      errors.push({
        message: `node "${name}" is over its noise budget: its cov() declarations sum to ${used.toFixed(4)}, exceeding its declared noise variance ${info.variance}`,
        line: firstLineFor.get(name),
        kind: 'validation',
      });
    }
  }

  return errors;
}

// ---- rule 3: acyclicity + topo order ------------------------------------

function findCycle(parentsByName: Map<string, Set<string>>): string[] | null {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const name of parentsByName.keys()) color.set(name, WHITE);
  const stack: string[] = [];

  function visit(name: string): string[] | null {
    color.set(name, GRAY);
    stack.push(name);
    for (const parent of parentsByName.get(name) ?? []) {
      const c = color.get(parent);
      if (c === GRAY) {
        const cycleStart = stack.indexOf(parent);
        return [...stack.slice(cycleStart), parent];
      }
      if (c === WHITE) {
        const found = visit(parent);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(name, BLACK);
    return null;
  }

  for (const name of parentsByName.keys()) {
    if (color.get(name) === WHITE) {
      const found = visit(name);
      if (found) return found;
    }
  }
  return null;
}

function topologicalOrder(parentsByName: Map<string, Set<string>>): string[] {
  const visited = new Set<string>();
  const order: string[] = [];

  function visit(name: string) {
    if (visited.has(name)) return;
    visited.add(name);
    for (const parent of parentsByName.get(name) ?? []) visit(parent);
    order.push(name);
  }

  for (const name of parentsByName.keys()) visit(name);
  return order;
}

function hasObservedCausalPair(observedNames: ReadonlySet<string>, parentsByName: Map<string, Set<string>>): boolean {
  const ancestorsCache = new Map<string, Set<string>>();
  function ancestorsOf(name: string): Set<string> {
    const cached = ancestorsCache.get(name);
    if (cached) return cached;
    const result = new Set<string>();
    const stack = [...(parentsByName.get(name) ?? [])];
    while (stack.length > 0) {
      const p = stack.pop()!;
      if (result.has(p)) continue;
      result.add(p);
      for (const gp of parentsByName.get(p) ?? []) stack.push(gp);
    }
    ancestorsCache.set(name, result);
    return result;
  }

  for (const outcome of observedNames) {
    const ancestors = ancestorsOf(outcome);
    for (const treatment of observedNames) {
      if (treatment !== outcome && ancestors.has(treatment)) return true;
    }
  }
  return false;
}

// ---- compiling the runtime Model ----------------------------------------

function compileExpr(exprNode: MathNode, declaredNames: ReadonlySet<string>): CompiledExpr {
  const compiled = exprNode.compile();
  return {
    parents: declaredParentsOf(exprNode, declaredNames),
    usesNoise: usesEpsAlias(exprNode),
    eval(scope) {
      return compiled.evaluate(scope);
    },
  };
}

function compileDistribution(dist: DistributionSource, declaredNames: ReadonlySet<string>): Distribution {
  return {
    name: dist.name,
    params: dist.args.map((arg) => compileExpr(arg.node, declaredNames)),
    sample: notImplementedSample,
  };
}

function compileNode(name: string, stmt: NodeStmt, declaredNames: ReadonlySet<string>, structuralParents: ReadonlySet<string>): Node {
  if (stmt.form === 'deterministic') {
    const expr = compileExpr(stmt.expr.node, declaredNames);
    return {
      id: name,
      visibility: stmt.latent ? 'latent' : 'observed',
      kind: 'deterministic',
      expr,
      noiseSD: expr.usesNoise ? 1 : undefined,
      parents: [...structuralParents],
    };
  }
  const dist = compileDistribution(stmt.dist, declaredNames);
  return {
    id: name,
    visibility: stmt.latent ? 'latent' : 'observed',
    kind: 'stochastic',
    dist,
    parents: [...structuralParents],
  };
}

function compileNoiseNode(name: string, stmt: NoiseStmt, declaredNames: ReadonlySet<string>, structuralParents: ReadonlySet<string>): Node {
  const dist = compileDistribution(stmt.dist, declaredNames);
  return {
    id: name,
    visibility: 'latent',
    kind: 'stochastic',
    dist,
    parents: [...structuralParents],
  };
}

function constantExpr(value: number): CompiledExpr {
  return { parents: [], usesNoise: false, eval: () => value };
}

function compileSyntheticLatent(id: string): Node {
  return {
    id,
    visibility: 'latent',
    kind: 'stochastic',
    dist: { name: 'Normal', params: [constantExpr(0), constantExpr(1)], sample: notImplementedSample },
    parents: [],
  };
}
