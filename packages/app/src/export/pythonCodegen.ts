// ARCHITECTURE.md §12 "Export": generated runnable Python code -- "quietly
// proves your numbers are honest: reviewers can run them." Replicates the
// model's DGP in numpy (independent of this app's own TS sampling engine,
// same principle packages/validation/scripts/*.py already follow) plus
// whichever estimates the current view has active. statsmodels covers
// naive/g-comp(polynomial)/IV/front-door; sklearn's KernelRidge is pulled
// in specifically (and only) when the app is showing the kernel-ridge
// basis, parameterized to match kernelRidge.ts exactly -- see the
// KERNEL_RIDGE_HELPER comment below for the parameter translation.
import type { Model, NodeId } from 'scm-dsl';
import { parseStatements } from 'scm-dsl';
import type { DistributionSource, ExprSource, StatementAst } from 'scm-dsl';
import { PYTHON_HELPERS, pyExpr, usesNoiseSymbol } from './pythonExpr.js';

const DIST_SAMPLERS: Record<string, (args: string[]) => string> = {
  Normal: (a) => `rng.normal(${a[0]}, ${a[1]}, size=N)`,
  Bernoulli: (a) => `(rng.random(N) < ${a[0]}).astype(float)`,
  Uniform: (a) => `rng.uniform(${a[0]}, ${a[1]}, size=N)`,
  Poisson: (a) => `rng.poisson(${a[0]}, size=N)`,
};

function nodeStatements(source: string): Map<NodeId, StatementAst> {
  const byName = new Map<NodeId, StatementAst>();
  for (const stmt of parseStatements(source).statements) {
    if (stmt.kind === 'node' || stmt.kind === 'noise') byName.set(stmt.name, stmt);
  }
  return byName;
}

function distributionOf(stmt: StatementAst): DistributionSource | null {
  if (stmt.kind === 'noise') return stmt.dist;
  if (stmt.kind === 'node' && stmt.form === 'stochastic') return stmt.dist;
  return null;
}

function exprOf(stmt: StatementAst): ExprSource | null {
  return stmt.kind === 'node' && stmt.form === 'deterministic' ? stmt.expr : null;
}

/** One numpy sampling line per node, in dependency order. Nodes with no
 * StatementAst entry are the synthetic latents `X <-> Y` sugar adds
 * (ARCHITECTURE.md §4.4) -- always Normal(0,1) per validate.ts's
 * compileSyntheticLatent, so no source lookup is needed for those. */
function dgpLines(model: Model, statements: Map<NodeId, StatementAst>): string[] {
  const lines: string[] = [];

  for (const id of model.topoOrder) {
    const node = model.nodes.get(id)!;
    const stmt = statements.get(id);

    if (!stmt) {
      lines.push(`${id} = rng.normal(0, 1, size=N)  # synthetic latent from a <-> declaration`);
      continue;
    }

    if (node.kind === 'deterministic') {
      const expr = exprOf(stmt)!;
      const noiseVar = `_eps_${id}`;
      if (usesNoiseSymbol(expr.node)) lines.push(`${noiseVar} = rng.normal(0, NOISE_SD, size=N)`);
      lines.push(`${id} = ${pyExpr(expr.node, noiseVar)}`);
      continue;
    }

    const dist = distributionOf(stmt)!;
    const sampler = DIST_SAMPLERS[dist.name];
    if (!sampler) {
      // A model can declare (and pass validation for) a distribution scm-engine
      // itself hasn't implemented sampling for yet (ARCHITECTURE.md §17 Phase 1
      // covers Normal/Bernoulli/Uniform/Poisson only) -- if so, the live app
      // can't run this model either, so this is not a new limitation.
      lines.push(`# "${dist.name}" sampling isn't implemented (matches the app's own Phase 1 scope).`);
      lines.push(`raise NotImplementedError("${dist.name} sampling not implemented")`);
      continue;
    }
    // Distribution parameters can themselves reference eps in principle,
    // but no example model does, and it's semantically unusual (fresh
    // unexplained noise seasoning a distribution's own parameter) -- an
    // undefined-name error here is an honest failure for that edge case,
    // not a silently wrong result.
    const args = dist.args.map((a) => pyExpr(a.node, '_UNSUPPORTED_EPS_IN_DIST_PARAM'));
    lines.push(`${id} = ${sampler(args)}`);
  }

  return lines;
}

// K(a,b) = exp(-||a-b||^2 / (2*bandwidth^2)), solving (K + lambda*I) alpha
// = y -- see kernelRidge.ts's own header comment. sklearn's KernelRidge
// uses K(a,b) = exp(-gamma*||a-b||^2) and solves (K + alpha*I) dual_coef =
// y, so gamma = 1/(2*bandwidth**2) and sklearn's alpha = our lambda give an
// exact match, not an approximation.
const KERNEL_RIDGE_HELPER = `def _kernel_ridge_gcomp(x_treatment, z_adjust, y, bandwidth, lam, grid):
    """RBF kernel ridge g-computation: fit on [treatment, *adjustment], then
    for each grid point average predictions over the empirical distribution
    of the adjustment covariates -- the same Monte Carlo g-formula as the
    polynomial-basis case, with a kernel-ridge fit standing in for OLS."""
    design = np.column_stack([x_treatment] + list(z_adjust))
    model = KernelRidge(alpha=lam, kernel="rbf", gamma=1 / (2 * bandwidth**2))
    model.fit(design, y)
    n = len(x_treatment)
    return np.array(
        [model.predict(np.column_stack([np.full(n, x)] + list(z_adjust))).mean() for x in grid]
    )
`;

export interface PythonExportParams {
  source: string;
  model: Model;
  treatment: NodeId;
  outcome: NodeId;
  adjustmentSet: ReadonlySet<NodeId>;
  instrument: NodeId | null;
  mediator: NodeId | null;
  basisMode: 'polynomial' | 'kernelRidge';
  degree: number;
  bandwidth: number;
  lambda: number;
  seed: number;
  noiseSD: number;
  sampleSize: number;
  isBinaryTreatment: boolean;
  /** Whether the live TS stratifyDoseResponse call actually succeeded for
   * the current adjustment set (as opposed to hitting its "too many strata"
   * cardinality guard, e.g. a continuous covariate) -- gates the generated
   * stratify section the same way the app's own results panel is gated, so
   * the exported script doesn't crash with a rank-deficient per-stratum fit
   * on a case the app itself already refuses to compute. */
  includeStratify: boolean;
}

export function modelToPython(params: PythonExportParams): string {
  const { source, model, treatment, outcome, adjustmentSet, instrument, mediator, basisMode, degree, bandwidth, lambda, seed, noiseSD, sampleSize, isBinaryTreatment, includeStratify } = params;
  const statements = nodeStatements(source);
  const observedIds = model.observed();
  const adjustment = [...adjustmentSet];

  const modelComment = source
    .split('\n')
    .map((line) => (line.startsWith('#') ? line : `# ${line}`))
    .join('\n');

  const sections: string[] = [];

  sections.push(`"""Generated by the Causal Inference Playground.

Replicates this model's data-generating process in numpy, then computes the
same estimates shown in the app via statsmodels -- an independent check of
those numbers (same principle as packages/validation/scripts/*.py in the
source repo). Uses numpy's own RNG, not the app's seeded generator, so exact
row values won't match; only population-level quantities agree, up to Monte
Carlo error.

Model source:
${modelComment}
"""
import numpy as np
import pandas as pd
import statsmodels.api as sm

SEED = ${seed}
N = ${sampleSize}
NOISE_SD = ${noiseSD}

${PYTHON_HELPERS}
rng = np.random.default_rng(SEED)

${dgpLines(model, statements).join('\n')}

data = pd.DataFrame({${observedIds.map((id) => `"${id}": ${id}`).join(', ')}})`);

  if (basisMode === 'polynomial') {
    sections.push(`# --- naive (unadjusted) ---
naive_fit = sm.OLS(data["${outcome}"], sm.add_constant(data["${treatment}"])).fit()
print("naive coefficients:")
print(naive_fit.params)`);

    if (adjustment.length > 0) {
      const powerCols = Array.from({ length: degree }, (_, i) => `data["${treatment}"]**${i + 1}`);
      const adjustCols = adjustment.map((id) => `data["${id}"]`);
      const designExpr = `np.column_stack([${[...powerCols, ...adjustCols].join(', ')}])`;
      sections.push(`# --- g-computation, adjusting for {${adjustment.join(', ')}} (degree-${degree} basis in ${treatment}) ---
gcomp_design = ${designExpr}
gcomp_fit = sm.OLS(data["${outcome}"], sm.add_constant(gcomp_design)).fit()
print("g-computation coefficients (treatment basis first, then adjustment set):")
print(gcomp_fit.params)`);

      // Stratified g-computation: no single statsmodels/sklearn primitive
      // for this, so a pandas groupby loop *is* the idiomatic Python
      // expression of the algorithm (mirrors stratify.ts's own strata
      // grouping/weighted-average structure). Only emitted when the live
      // app's own stratifyDoseResponse succeeded for this adjustment set --
      // a continuous covariate makes almost every row its own stratum,
      // which the TS side rejects via a cardinality guard but an
      // unconditional groupby loop here would instead crash on (a
      // rank-deficient per-stratum fit with no free parameters left over).
      if (includeStratify) {
        const stratifyGroupCols = adjustment.map((id) => `"${id}"`).join(', ');
        const stratifyPowers = Array.from({ length: degree }, (_, i) => i + 1);
        sections.push(`# --- stratification, adjusting for {${adjustment.join(', ')}} (degree-${degree} basis in ${treatment}) ---
strat_grid = np.linspace(data["${treatment}"].min(), data["${treatment}"].max(), 5)
strat_ys = np.zeros_like(strat_grid)
for _, group in data.groupby([${stratifyGroupCols}]):
    design = np.column_stack([group["${treatment}"]**d for d in [${stratifyPowers.join(', ')}]])
    fit = sm.OLS(group["${outcome}"], sm.add_constant(design)).fit()
    weight = len(group) / len(data)
    for i, x in enumerate(strat_grid):
        xrow = np.array([x**d for d in [${stratifyPowers.join(', ')}]])
        strat_ys[i] += weight * (fit.params.iloc[0] + xrow @ fit.params.iloc[1:].values)
print("stratification dose-response:")
for x, y in zip(strat_grid, strat_ys):
    print(f"  ${treatment}={x:.3f} -> ${outcome}={y:.3f}")`);
      }
    }
  } else {
    sections.push(`# --- kernel ridge (RBF) setup ---
from sklearn.kernel_ridge import KernelRidge

BANDWIDTH = ${bandwidth}
LAMBDA = ${lambda}

${KERNEL_RIDGE_HELPER}
kr_grid = np.linspace(data["${treatment}"].min(), data["${treatment}"].max(), 5)`);

    sections.push(`# --- naive (unadjusted, kernel ridge) ---
naive_curve = _kernel_ridge_gcomp(data["${treatment}"].values, [], data["${outcome}"].values, BANDWIDTH, LAMBDA, kr_grid)
print("naive (kernel ridge) dose-response:")
for x, y in zip(kr_grid, naive_curve):
    print(f"  ${treatment}={x:.3f} -> ${outcome}={y:.3f}")`);

    if (adjustment.length > 0) {
      const adjustList = `[${adjustment.map((id) => `data["${id}"].values`).join(', ')}]`;
      sections.push(`# --- g-computation, adjusting for {${adjustment.join(', ')}} (kernel ridge, RBF) ---
gcomp_curve = _kernel_ridge_gcomp(data["${treatment}"].values, ${adjustList}, data["${outcome}"].values, BANDWIDTH, LAMBDA, kr_grid)
print("g-computation (kernel ridge) dose-response:")
for x, y in zip(kr_grid, gcomp_curve):
    print(f"  ${treatment}={x:.3f} -> ${outcome}={y:.3f}")`);
    }
  }

  if (instrument) {
    sections.push(`# --- IV / 2SLS via ${instrument} ---
iv_stage1 = sm.OLS(data["${treatment}"], sm.add_constant(data["${instrument}"])).fit()
treatment_hat = iv_stage1.predict(sm.add_constant(data["${instrument}"]))
iv_stage2 = sm.OLS(data["${outcome}"], sm.add_constant(treatment_hat)).fit()
print(f"2SLS estimate (LATE, if effects are heterogeneous): {iv_stage2.params.iloc[1]:.4f}")
print(f"first-stage F: {iv_stage1.fvalue:.1f}")`);
  }

  if (mediator) {
    sections.push(`# --- front-door via ${mediator} ---
fd_stage1 = sm.OLS(data["${mediator}"], sm.add_constant(data["${treatment}"])).fit()
fd_stage2 = sm.OLS(data["${outcome}"], sm.add_constant(np.column_stack([data["${mediator}"], data["${treatment}"]]))).fit()
frontdoor_estimate = fd_stage1.params.iloc[1] * fd_stage2.params.iloc[1]
print(f"front-door estimate: {frontdoor_estimate:.4f}")`);
  }

  if (isBinaryTreatment) {
    // Propensity model via statsmodels' Logit -- a well-known, idiomatic
    // replacement for the hand-rolled IRLS loop in logistic.ts. The
    // Horvitz-Thompson/augmentation combination itself has no library
    // one-liner, so it's hand-transcribed (same category as IV's/front-
    // door's two-line combination step above).
    const adjustCols = adjustment.map((id) => `"${id}"`).join(', ');
    sections.push(`# --- inverse-propensity weighting (IPW), adjusting for {${adjustment.join(', ')}} ---
ps_design = sm.add_constant(data[[${adjustCols}]]) if [${adjustCols}] else sm.add_constant(pd.DataFrame(index=data.index))
ps_fit = sm.Logit(data["${treatment}"], ps_design).fit(disp=0)
ps = ps_fit.predict(ps_design).clip(1e-3, 1 - 1e-3)
treated = data["${treatment}"] == 1
mu_t = (data.loc[treated, "${outcome}"] / ps[treated]).sum() / (1 / ps[treated]).sum()
mu_c = (data.loc[~treated, "${outcome}"] / (1 - ps[~treated])).sum() / (1 / (1 - ps[~treated])).sum()
ipw_estimate = mu_t - mu_c
overlap = np.where(treated, ps, 1 - ps)
print(f"IPW ATE: {ipw_estimate:.4f}, min overlap: {overlap.min():.4f}")

# --- doubly-robust AIPW (reuses ps_fit/ps above), adjusting for {${adjustment.join(', ')}} ---
outcome_design = sm.add_constant(data[["${treatment}", ${adjustCols}]]) if [${adjustCols}] else sm.add_constant(data[["${treatment}"]])
outcome_fit = sm.OLS(data["${outcome}"], outcome_design).fit()
design1 = outcome_design.copy(); design1["${treatment}"] = 1
design0 = outcome_design.copy(); design0["${treatment}"] = 0
mu1 = outcome_fit.predict(design1)
mu0 = outcome_fit.predict(design0)
aug = np.where(treated, (data["${outcome}"] - mu1) / ps, -(data["${outcome}"] - mu0) / (1 - ps))
aipw_estimate = (mu1 - mu0 + aug).mean()
print(f"AIPW ATE: {aipw_estimate:.4f}")`);
  }

  return sections.join('\n\n') + '\n';
}
