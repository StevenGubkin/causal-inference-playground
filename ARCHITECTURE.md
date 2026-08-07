# Causal Inference Playground — Architecture Spec (standalone product)

An interactive web app where a user writes a structural causal model (SCM) as
equations, the app renders the DAG and samples data, the user chooses an estimand
and an identification strategy, and the app compares the estimated causal
relationship against the **true interventional ground truth**.

This is written to be handed to a coding agent. It is opinionated on purpose. Where
it says **INVARIANT**, treat it as a hard requirement with a test.

Audience note that shapes every priority below: this is meant to be a public,
shareable product that earns credibility in data-science / causal-inference
communities and doubles as portfolio evidence of causal-inference expertise. With
that audience, **correctness is the marketing.** People who read Pearl, Hernán &
Robins, and Imbens & Rubin will probe edge cases within minutes; one wrong
do-calculus result and the credibility is gone. So rigor, validation against
reference implementations, and literature-faithful vocabulary are treated as
first-class product features, not polish.

---

## 0. The one idea everything serves

In a simulation you have the ground truth, which you never have with real data. The
product exists to exploit that: show the user's estimate, the true answer, the bias,
and *why* the bias is there (which path they left open).

- **The estimand is not the equation.** `Y = cos(X) + A*B + ε` is not the causal
  curve. The causal curve is `x ↦ E[Y | do(X=x)]`, which differs from the equation
  whenever conditioning on X reopens a backdoor path. Ground truth is produced by
  intervening on the graph, never by evaluating the formula.
- **Observational ≠ interventional.** `E[Y|X=x]` (what a naive fit recovers) and
  `E[Y|do(X=x)]` (the truth) are different objects; the UI must always say which.

---

## 1. Scope and non-goals

**v1 scope.** Acyclic SCMs over scalar nodes; continuous and discrete/stochastic
nodes; observed and latent variables; atomic interventions `do(X=x)`; estimands
ATE / ATT / dose–response / CATE; estimators from a naive baseline through
doubly-robust, IV, and frontdoor; an identifiability gate; a Monte-Carlo mode; a
paradox gallery; shareable permalinks and export.

**Non-goals for v1** (design for, don't build — sections 15–16): cyclic/feedback
models, time-indexed panels and g-methods, the full Shpitser–Pearl ID algorithm,
causal discovery, sensitivity analysis, quantile/distributional effects.

---

## 2. What "credible in DS communities" requires (product goals)

These are requirements, tested and shipped, not aspirations.

1. **Correct to the literature.** Every estimator and identification result matches
   the textbook definition and the community's vocabulary (section 8).
2. **Validated against reference implementations.** Estimates match DoWhy, EconML,
   statsmodels/linearmodels, and dagitty on canonical problems within Monte-Carlo
   tolerance (section 10). This single feature is the strongest credibility signal
   the product can carry, and it is portfolio evidence in itself.
3. **Every state is a permalink.** The full model + query + seed serialize into the
   URL, so anything a user builds is one shareable link (section 12). This is the
   primary distribution mechanism.
4. **A visceral demo.** An interactive paradox gallery where dragging one slider
   flips an estimate's sign or breaks CI coverage, live (sections 11, 13). This is
   what actually gets shared.
5. **Permissively licensed.** MIT throughout; the `engine` and `estimators`
   packages carry no UI dependency and are structurally independent of `app`
   (section 3) — reusable within this repo (already are, by `validation/`) even
   though standalone npm publishing isn't a goal (the realistic external audience
   for a TypeScript causal-inference library is small; Python/R already has DoWhy,
   EconML, statsmodels).
6. **Honest uncertainty.** CIs reflect real sampling variability, so the tool can
   *demonstrate* confidently-wrong misspecification rather than hide it (section 8).

Sober expectation-setting: catching on is mostly downstream of (2) + (4) +
distribution timing + luck. Build (2) and (4) as if they are the product, ship one
genuinely delightful gallery entry, and let the rest follow.

---

## 3. Stack and package layout

A standalone React app. All dependencies MIT/Apache-2.0 — no copyleft, no WASM build
step. Dependency direction is strict and one-way:
`app → estimators → engine → graph → dsl`. The engine never imports React; the
estimators never import the UI.

```
causal-playground/
  packages/
    scm-dsl/       # grammar, parser, AST, static validation
    scm-engine/    # model IR, samplers, forward + interventional sampling, oracle
    graph/         # DAG algorithms: layering, d-separation, backdoor/frontdoor/IV, ID
    estimators/    # estimator registry, implementations, identifiability gate
    validation/    # cross-checks vs DoWhy / EconML / statsmodels / dagitty fixtures
    share/         # URL codec (model+query+seed -> compact hash and back)
    app/           # React UI
    examples/      # gallery models (.scm) + expected-answer fixtures
  package.json     # workspaces
```

Chosen libraries (rationale in section 14):

- **DAG UI:** React Flow (`@xyflow/react`, v12, MIT) for draggable node-link graphs;
  `dagre` or `elkjs` for automatic layered layout.
- **Equation input:** MathLive (`<math-field>`, MIT) — accessible, mobile keyboards,
  LaTeX/MathML/MathJSON export.
- **Expression parse/eval:** `mathjs` (Apache-2.0) as the default. (MathLive's
  CortexJS Compute Engine is an acceptable alternative; do not use both.)
- **Plotting:** Plotly.js (MIT) for the statistical/interactive plots; `recharts`
  is an acceptable lighter alternative for simpler charts. Pick one and stay
  consistent.
- **State:** plain React state + a memoized compute pipeline, or a small store
  (Zustand/Jotai). No reactive-framework runtime.
- **PRNG:** a small seedable generator (PCG/xorshift). **Required**; `Math.random()`
  is not acceptable — reproducible permalinks and common random numbers depend on an
  explicit seed (INVARIANTs, sections 6, 12).

`scm-engine` and `estimators` must have zero UI dependencies — good architecture on
its own (testable in isolation, already reused by `validation/` without `app`), and
what makes the worker-boundary design below possible regardless of whether these
ever ship as standalone npm packages (not currently a goal — see REMAINING.md).

The main thread never constructs a compiled `Model` (§5) directly — `CompiledExpr`'s
`eval` closures aren't structured-clone-safe, so a compiled `Model` can't cross a
`postMessage` boundary. Instead `app/` holds only DSL source text and results; a
small worker pool (sized to `navigator.hardwareConcurrency`) owns parsing, sampling,
the oracle, and estimation end-to-end, and returns plain data (`Sample`/`Curve`/
`EstimateResult`, whose `Float64Array` columns transfer zero-copy). This keeps the
UI thread free for the live-slider interaction (§11) and lets Monte-Carlo mode
(§11) parallelize independent replicates across workers trivially, since each
replicate needs only its own seed.

> **As actually built:** no worker pool exists — every recompute, including Monte
> Carlo mode, runs synchronously on the main thread. A real benchmark (timing
> `forwardSample` + every estimator against the built packages) showed replicate
> cost tops out around 4ms even with all five backdoor-family estimators active, so
> Monte Carlo mode just chunks its replicate loop into `setTimeout`-batched groups
> of 25 with a live progress counter — enough to keep the UI responsive without the
> `postMessage`/structured-clone complexity a worker pool would add. Revisit this
> if a future feature's per-recompute cost turns out to need genuine parallelism.

---

## 4. The DSL

### 4.1 Design goals

Read like the math the user already writes (`Y = cos(X) + A*B + eps`,
`A ~ Bernoulli(0.7)`, `C ~ Normal(0, 3)`), and make first-class the four things a
naive additive-noise DAG can't express: **stochastic (non-Gaussian) nodes**,
**per-equation independent noise**, **latent/unobserved variables**, and **latent
confounding** (correlated noise / bidirected edges).

### 4.2 Node kinds

Every node is a draw. Two surface forms:

- `NAME = expr` — **deterministic** endogenous node (a point mass). Value is `expr`
  over its parents (plus its own noise term if referenced).
- `NAME ~ Dist(arg, ...)` — **stochastic** node; parameters are expressions over
  parents. This generalizes the prototype's root-only `A ~ Bernoulli(0.7)` to
  parameter-dependent distributions, which real outcomes need:
  - `Y ~ Bernoulli(logistic(0.5*X - C))`   (binary outcome)
  - `N ~ Poisson(exp(a + b*X))`            (count outcome)
  - `Y ~ Normal(f(X), sigma)`              (location-scale / heteroskedastic)

  A root exogenous node is a stochastic node with constant parameters.

### 4.3 Noise

- **Implicit per-equation noise.** A bare `eps` (alias `epsilon`, `ε`) in a `=`
  expression injects an *independent* draw for that node, default `Normal(0, σ)`,
  per-node `σ` (global default 1). **INVARIANT:** two equations that each write
  `eps` get *independent* noise. Sharing is never implicit.
- **Named noise.** `noise U ~ Normal(0, 1)` declares a reusable exogenous term;
  referencing `U` in two equations makes it a shared unobserved cause (a confounder).
  This — or an explicit `latent NAME ~ Dist(...)` referenced by name in two
  equations — is the one way to build correlated/confounded noise; there is no
  separate covariance-target sugar. Reproducing a specific target covariance `c`
  by hand is one line: a shared `latent U ~ Normal(0, 1)` with loadings
  `λx = λy = sqrt(c)` (or opposite signs if `c < 0`) added into each equation
  gives `Cov(X, Y) = λx·λy = c`. (An earlier `cov(X, Y) = c` sugar for this was
  retired — it never got a real sampling implementation, and the only thing it
  bought beyond the one-liner above was multi-declaration noise-budget
  bookkeeping, a narrow convenience not worth the implementation cost.)

### 4.4 Latents and bidirected edges

- `latent NAME ...` — a full node (may have parents/children) present in the DGP and
  the oracle but **stripped from the sample handed to estimators** (INVARIANT,
  section 7). Default visibility is `observed`.
- `X <-> Y` — sugar for `latent U_XY ~ Normal(0,1)` added as a parent of both `X`
  and `Y`: an unobserved common cause. This is what makes IV, frontdoor, and
  identifiability interesting.

### 4.5 Grammar (EBNF)

```ebnf
program      = { statement } ;
statement    = comment | nodeDecl | noiseDecl | biDecl ;
comment      = "#" , { any-char-except-newline } ;
nodeDecl     = [ "latent" ] , IDENT , ( "=" , expr | "~" , distribution ) ;
noiseDecl    = "noise" , IDENT , "~" , distribution ;
biDecl       = IDENT , "<->" , IDENT ;
distribution = IDENT , "(" , [ expr , { "," , expr } ] , ")" ;
expr         = (* infix arithmetic over IDENT/number/funcCall; RHS delegated to mathjs *) ;
IDENT        = letter , { letter | digit | "_" } ;
```

Implementation: a small hand-written (or Chevrotain) **line-level** parser handles
the statement forms (`~`, `=`, `latent`, `<->`, `noise`); only the RHS
**expressions** are handed to `mathjs.parse`. Do not try to make mathjs parse the
whole DSL — the SCM-specific tokens aren't standard math.

### 4.6 Distributions (v1)

`Normal`, `Bernoulli`, `Uniform`, `Poisson`, `Binomial`, `Categorical`,
`Exponential`, `Gamma`, `Beta`, `LogNormal`, plus the implicit `PointMass` for `=`.
Each is a `Distribution` object (section 5); parameters are evaluated per row against
parent values before drawing.

### 4.7 Built-in expression functions

`logistic`/`sigmoid`, `exp`, `log`, `sqrt`, `abs`, `sin`, `cos`, `min`, `max`,
`step`/`indicator`, `clamp`, plus whatever `mathjs` provides. Link functions are how
a linear predictor becomes a valid distribution parameter.

### 4.8 Static validation (parse-time)

Return either a `Model` IR or typed, author-facing errors:

1. Every identifier resolves to a node, noise term, number, or known function.
2. Parents of a node = declared identifiers in its expression (`=`) or its
   distribution's argument expressions (`~`); function names and noise excluded.
3. The directed graph is **acyclic** (Kahn); a cycle is a hard error naming the path.
4. Distribution arity/domain sanity for constant params; parent-dependent domain
   violations become runtime diagnostics, not crashes.
5. At least one valid treatment and one valid outcome exist.
6. **Security boundary, not just UX.** A `Model` can arrive from an untrusted
   permalink or iframe embed, so rule 1's identifier/function resolution must be
   enforced as an allow-list *after* `mathjs.parse`, independent of `mathjs`'s own
   scope handling — walk the parsed expression tree and reject any node referencing
   a name outside the declared nodes/noise terms/§4.7 function list before
   `evaluate()` ever runs. Do not rely on `mathjs`'s default scope to be safe by
   itself: construct a restricted instance via `math.create()` with only the needed
   functions imported (no `import`, no matrix/unit constructors), and pin to a
   current, patched `mathjs` release. Treat a would-be sandbox escape as a security
   bug with a fixture in section 10a, not just a parser edge case.

---

## 5. Model IR and distributions

```ts
type NodeId = string;
type Visibility = "observed" | "latent";

interface CompiledExpr {
  parents: NodeId[];
  usesNoise: boolean;
  eval(scope: Record<string, number>): number;   // scope = parents (+ eps)
}
interface Distribution {
  name: string;
  params: CompiledExpr[];
  sample(paramValues: number[], rng: RNG): number;
  mean?(paramValues: number[]): number;           // analytic hook for the oracle
}
interface Node {
  id: NodeId; visibility: Visibility;
  kind: "deterministic" | "stochastic";
  expr?: CompiledExpr; dist?: Distribution; noiseSD?: number;
  parents: NodeId[];                               // incl. latent parents from <->
}
interface Model {
  nodes: Map<NodeId, Node>;
  noise: Map<string, { id: string; dist: Distribution }>;
  topoOrder: NodeId[];                             // incl. latents
  observed(): NodeId[];
  parentsOf(id: NodeId): NodeId[];
  childrenOf(id: NodeId): NodeId[];
}
```

Deterministic nodes are internally a `PointMass` distribution (single sampler code
path); the surface kind is retained for the UI and the "true structural relationship"
display.

---

## 6. Sampling and intervention engine

Plain TypeScript, deterministic given a seed, no React.

```ts
interface RNG {
  next(): number; normal(): number;
  fork(streamId: string): RNG;
  snapshot(): RNGState; restore(s: RNGState): void;
}
interface Sample { n: number; columns: Map<NodeId, Float64Array>; observed(): ObservedSample; }
interface Curve { xs: number[]; ys: number[]; }

function forwardSample(model: Model, n: number, rng: RNG): Sample;

interface Oracle {
  doResponse(model, treatment, outcome, grid: number[], m: number, rng: RNG): Curve;
  doContrast(model, treatment, outcome, a: number, b: number, m: number, rng: RNG): number;
  observationalResponse(sample: Sample, treatment, outcome, grid: number[]): Curve; // display only
}
```

**INVARIANT (seeded):** all randomness flows through an explicitly seeded `RNG`. No
`Math.random()` in `scm-engine`.

**INVARIANT (intervention by mutilation):** `doResponse`/`doContrast` compute the
estimand by (a) removing the treatment's assignment, (b) fixing it to the intervened
value (cutting incoming edges), (c) resampling every downstream node. Never evaluate
the treatment's structural equation; never read the estimand off the formula. This
is the single most credibility-critical property; it gets a dedicated test and a
cross-library check (section 10).

**INVARIANT (common random numbers):** across the grid, reuse one frozen draw of all
exogenous noise (roots, named noise, latents, every implicit `eps`), changing only
the intervened node and recomputing its descendants. This removes point-to-point
jitter and slashes the variance of slopes/contrasts. Implement via
`snapshot()/restore()` or a pre-drawn exogenous noise matrix threaded through all
grid points.

Stochastic (`do(X ~ Dist)`) and conditional (`do(X = g(Z))`) interventions are
extension points already admitted by the interface.

---

## 7. The observed/latent boundary

```ts
interface ObservedSample { n: number; columns: Map<NodeId, Float64Array>; } // observed only
```

**INVARIANT (latent stripping):** estimators receive an `ObservedSample`; the oracle
receives the full model and sample. No code path lets an estimator read a latent
column. This is what makes the hard problems genuinely hard for the estimators, for
the same reason they are hard in reality.

---

## 8. Estimands and the estimator interface

Use the community's vocabulary exactly; label everything in the UI and docs with the
canonical name and a one-line reference. Fluency here is half the credibility.

```ts
type Estimand =
  | { kind: "ATE"; a: number; b: number }
  | { kind: "ATT"; a: number; b: number }
  | { kind: "doseResponse"; grid: number[] }
  | { kind: "CATE"; grid: number[]; covariate: NodeId };

interface CausalQuery {
  treatment: NodeId; outcome: NodeId; estimand: Estimand;
  adjustmentSet?: NodeId[];   // user-chosen; validated, not assumed correct
  instrument?: NodeId;        // IV
  mediators?: NodeId[];       // frontdoor
}
interface Requirement { text: string; satisfied: boolean; }
interface EstimateResult {
  estimand: Estimand;
  point: Curve | number;
  ci?: { lo: Curve | number; hi: Curve | number };
  diagnostics: Record<string, number>;   // overlapMin, firstStageF, effectiveN, ...
  warnings: string[];
}
interface Estimator {
  id: string; label: string; reference: string;   // e.g. "Robins 1986; Hernán & Robins, ch. 13"
  requirements(model: Model, query: CausalQuery): Requirement[];
  applicable(model: Model, query: CausalQuery): { ok: boolean; reasons: string[] };
  estimate(sample: ObservedSample, model: Model, query: CausalQuery, rng: RNG): EstimateResult;
}
```

**INVARIANT (estimand-appropriate comparison):** compare like with like — a
dose–response estimate against `oracle.doResponse`, an ATE against
`oracle.doContrast`. The observational curve is shown as a *third reference*, never
labeled "truth."

**INVARIANT (honest CIs):** CIs reflect real sampling variability (bootstrap by
default, analytic where exact). It must be possible to demonstrate the classic
failure where a *misspecified* model yields *tight, confidently wrong* intervals. Do
not synthesize CIs from residuals of a model assumed correct.

### v1 estimators

| id          | label                          | reference / note                                  | core requirement                          |
|-------------|--------------------------------|---------------------------------------------------|-------------------------------------------|
| `naive`     | Naive / unadjusted             | baseline; shows the bias                          | none                                       |
| `gcomp`     | Regression adjustment (g-comp) | Robins 1986; the g-formula                         | valid backdoor set selected                |
| `stratify`  | Stratification                 | textbook backdoor adjustment                       | low-cardinality discrete backdoor set      |
| `ipw`       | Inverse-propensity weighting   | Horvitz–Thompson; Rosenbaum & Rubin                | valid backdoor set + positivity/overlap    |
| `aipw`      | Doubly-robust (AIPW)           | consistent if outcome *or* propensity model right | valid backdoor set                          |
| `iv2sls`    | Instrumental variables (2SLS)  | see LATE note below                                | valid instrument (relevance + exclusion)   |
| `frontdoor` | Frontdoor adjustment           | Pearl's frontdoor criterion                        | valid mediator set, no unblocked confounding|

**IV/LATE precision (get this exactly right — the econ/CI crowd will check):** 2SLS
recovers the ATE only under constant/linear treatment effects; under effect
heterogeneity with a binary instrument and monotonicity it identifies the LATE (the
complier average). The UI must state which it is reporting and, when the DGP has
heterogeneous effects, label the 2SLS result "LATE (compliers)" and show that it
differs from the population ATE the oracle computes. Demonstrating that distinction
correctly is a credibility win most tools skip.

Building a model where this divergence is real requires explicit compliance
heterogeneity, not just instrument noise — see METHODS.md's worked construction
(potential-outcome parents `D(0)`/`D(1)`, monotonicity via `max`). Ship it as a
committed `.scm` fixture with precomputed values; it is the natural IV/LATE row in
the section 10b validation table.

The flexible-in-X basis (to recover nonlinear dose–response like `cos`) lives in
`gcomp`/`aipw`; expose the basis (polynomial degree / splines / RBF) as an option,
since recovering a cosine is exactly a "flexible learner" demonstration.

A user choosing a *wrong* adjustment set is allowed and instructive: `applicable`
returns `ok:false` with a reason ("Z is a collider on X↔Y; adjusting opens a
spurious path"); if they proceed, the estimate visibly diverges from truth. That
divergence is the lesson.

---

## 9. Graph algorithms and identifiability (`graph/`)

Pure functions over the ADMG (including latents and bidirected edges). These power
the identifiability gate and the DAG view, and they are credibility-critical:
validate them against **dagitty**, the community-standard reference.

```ts
function topoLayers(model): NodeId[][];
function ancestors(model, s: Set<NodeId>): Set<NodeId>;
function dSeparated(model, x, y, given: Set<NodeId>): boolean;         // handles bidirected paths
function backdoorValid(model, x, y, z: Set<NodeId>): { ok: boolean; reason?: string };
function frontdoorValid(model, x, y, m: Set<NodeId>): { ok: boolean; reason?: string };
function instrumentValid(model, x, y, iv: NodeId, given: Set<NodeId>): { ok: boolean; reason?: string };
function findBackdoorSet(model, x, y): NodeId[] | null;                // over observed vars
function testableImplications(model): CI_Statement[];                  // for the "vs dagitty" check
```

`dSeparated` must treat a bidirected edge as an open path through a latent common
cause. `backdoorValid` blocks all backdoor paths and forbids descendants of `x` in
`z`. v1 covers backdoor, frontdoor, and single-instrument IV — enough for the whole
paradox gallery.

**Highest-cred stretch (section 16):** the general ID algorithm (Tian–Pearl /
Shpitser–Pearl `ID`) returning whether `P(Y | do(X))` is identifiable from the ADMG
and, if so, the estimand functional. Validate against `Ananke` (Python). This is the
hardest piece and the one that most signals genuine expertise; keep it out of v1 but
architect `graph/` so it slots in.

---

## 10. Correctness invariants and the validation engine

Two test layers. The first is internal golden tests; the second — cross-library
validation — is the credibility engine and a portfolio artifact on its own.

### 10a. Internal golden tests (fixed seed, numeric tolerance)

1. **Intervention by mutilation.** Linear confounding
   `C~N(0,1); X=1.5C+eps; Y=2X+3C+eps`: `oracle.doContrast` slope ≈ `2.00 ± 0.05`;
   naive slope ≈ `3.38`; `gcomp{C}` ≈ `2.00`. (Numbers already validated in the
   prototype.)
2. **Independent per-equation noise.** Two `eps`-using nodes have sample noise
   correlation ≈ 0.
3. **Latent stripping.** `ObservedSample` never contains a `latent` column.
4. **Common random numbers.** Do-curve second differences below threshold (no
   jitter); slope variance across seeds materially below naive per-point resampling.
5. **Estimand-appropriate comparison.** On a collider model, adjusting for the
   collider *increases* measured bias vs `doResponse`.
6. **Honest CIs.** Correct spec → bootstrap coverage ≈ nominal; deliberately
   misspecified estimator → coverage visibly below nominal.
7. **Malicious payload rejection.** A permalink encoding a model that references
   an unresolvable identifier, a disallowed function, or an `import`-style escape
   is rejected at parse time with a typed error, never reaching `evaluate` (§4.8
   rule 6).

### 10b. Cross-library validation (`validation/`)

For each canonical problem, assert the app's estimate matches an external reference
within Monte-Carlo tolerance. Ship the fixtures (expected numbers precomputed) so the
suite runs in CI without Python; keep the generating scripts in-repo for provenance.

| problem                        | reference implementation                    | what must match                    |
|--------------------------------|---------------------------------------------|------------------------------------|
| backdoor ATE (confounding)     | DoWhy (identify+estimate), statsmodels OLS  | point estimate + CI                 |
| IPW / AIPW ATE                 | DoWhy / EconML                              | point estimate                      |
| IV / 2SLS (LATE)               | linearmodels IV2SLS                         | coefficient + first-stage F         |
| frontdoor                      | DoWhy frontdoor                             | point estimate                      |
| d-separation / adjustment sets | dagitty                                     | set membership + testable implic.   |
| worked examples                | IHDP (Hill 2011) semi-synthetic benchmark   | point estimate + known ground truth |

"Every estimator validated against DoWhy/EconML/dagitty within tolerance" is a
sentence that belongs in the README and on your résumé.

---

## 11. UI (`app/`)

Role color encodes causal role identically everywhere (treatment / outcome /
adjustment / latent / other); it is the app's visual signature. Latents drawn dashed;
bidirected edges as dashed arcs.

- **Model entry:** a MathLive `<math-field>` per equation (real math notation), plus
  a plain code-editor view for the whole model. Offer both; keep them in sync.
- **DAG:** React Flow — draggable nodes, arrowed edges, auto-layout via dagre/elkjs.
  Selecting an adjustment set highlights nodes and the paths it blocks/opens. Every
  edge into the current treatment node is drawn red/dashed — exactly (and only) the
  edges `do(X=x)` cuts, since mutilation is always a strict subgraph of the original
  DAG (confirmed against `oracle.ts`: the treatment's own structural equation is
  simply never evaluated; nothing more elaborate ever happens, including for a
  `<->`-desugared latent's edge into the treatment).
- **Comparison chart:** Plotly — true `do(X)` curve, naive `E[Y|X]`, the chosen
  estimator's curve, and a shaded band for the bias (gap between naive and truth).
  The estimand selector drives which oracle call is the reference.
- **Strategy panel:** estimator dropdown; the identifiability gate renders each
  estimator's `requirements` as a checklist and disables (with reasons) any whose
  `applicable` is false — with an override to *see* the failure.
- **The signature interaction (this is what gets shared):** a live slider on a
  gallery model — confounding strength, selection rate, effect heterogeneity — where
  the estimated effect visibly flips sign or the CI stops covering the truth as you
  drag. Wire at least Simpson reversal and M-bias to this.
- **Monte-Carlo mode:** run the pipeline `N` times (10–1000, chunked into batches of
  25 via `setTimeout` so the UI stays responsive — see §3's "as actually built"
  note); plot the sampling distribution of each applicable estimator's ATE estimate
  as an overlaid histogram, with a bias/RMSE readout against the correct truth
  (population ATE, or the complier LATE specifically for 2SLS). **Shipped**, including
  CI *coverage*: an opt-in checkbox (`coverageCheck.ts`) that, for each outer
  replicate, also bootstraps a small CI around *that replicate's own sample*
  (percentile or basic only — BCa's jackknife pass was excluded, see below) and
  reports what fraction of replicates' CIs contained the truth. The original
  "40,000+ estimator calls" cost estimate assumed reusing the single-run panel's
  default inner-bootstrap count (200) naively; a real benchmark after fixing a 5x
  redundancy bug (an early draft looped the inner bootstrap once per estimator key
  instead of once per outer replicate, since one resample's `computeEstimateSet`
  call already yields every active estimator) showed the honest cost is `R × inner`
  calls with a lean default `inner = 30` — multi-second to tens-of-seconds, not
  minutes. Batches shrink to 2 outer replicates per `setTimeout` tick (vs. 25) when
  coverage is on, since each outer replicate now does much more work per tick.
- **Confidence intervals:** a separate panel (`bootstrapCi.ts`), single-run ATE view
  only, toggling between three nonparametric bootstrap methods — percentile,
  basic/pivotal, and BCa. None strictly dominates: percentile is
  transformation-respecting (equivariant under monotone reparametrization) but
  doesn't correct a location bias between the bootstrap distribution's center and
  the real estimate; basic/pivotal (`2·estimate − q(1-α/2)`, `2·estimate − q(α/2)`,
  derived directly from `estimate − t0 ≈ resample − estimate`) corrects that bias via
  reflection but assumes shift-symmetry on the current scale; BCa gets both
  properties via a `z0` (bias) and `a` (acceleration, from a jackknife's skewness)
  adjustment, at the cost of an `n`-row leave-one-out jackknife pass on top of the
  bootstrap pass every method needs — roughly doubles-to-triples wall-clock versus
  percentile/basic alone, still fine chunked and user-triggered. Resamples the
  *actual observed sample* (`resampleRows`, `estimators/bootstrap.ts`), never a
  fresh population draw — deliberately different from Monte-Carlo mode's per-
  replicate `forwardSample`, since a bootstrap CI is specifically "what you could
  compute from real data alone."
- **Off-main-thread compute.** Aspirational (see §3): in practice every recompute,
  including Monte-Carlo mode and the confidence-interval panel above, runs on the
  main thread. The live slider described above — and its two-tier bootstrap-CI
  update strategy for *that* interaction specifically — has not been built at all;
  the app instead uses plain number inputs/checkboxes with a debounced full
  recompute on every change, which real benchmarking has shown is fast enough
  without a live-drag fast path.

The UI never computes ground truth; it calls the `Oracle`. It never lets an
estimator call the `Oracle`.

---

## 12. Distribution: permalinks, embedding, export

- **Permalinks (`share/`).** Serialize `{ model, query, seed }` to a compact string
  (JSON → LZ-string → URL hash). Every state is a link; the gallery is just a set of
  permalinks. **INVARIANT:** the seed is part of the shared state, so a link
  reproduces the exact figure. This is the main growth loop.
  **INVARIANT (versioned permalinks):** the serialized payload's first field is a
  `schemaVersion`; `share/` ships a migration chain
  (`migrations: Record<version, (old) => next>`) run on decode before the model
  reaches the parser. A link with no automated migration path shows an explicit
  "created with an incompatible version" message rather than silently misparsing
  or crashing. Since permalinks are the main growth loop, a link breaking on a
  future DSL or query-shape change is not a bug to fix later — the version field
  is what makes that not happen.
- **Embeddable widget.** A build target that renders a single read-only-or-live
  playground in an `<iframe>` (and/or a web component), so people can drop a live
  demo into a blog post, course page, or forum reply. A large distribution multiplier
  for a teaching tool.
- **Export.** Model as `.scm`; sample as CSV; DAG as SVG; and **generated runnable
  Python** (statsmodels, scikit-learn where the active view uses a kernel/logistic
  fit) reproducing the analysis. R export was considered and deliberately dropped —
  one target kept in exact sync with the TS math is worth more than two drifting out
  of it. The code-export bridges the playground to real workflows and quietly proves
  your numbers are honest — reviewers can run them.

---

## 13. The paradox gallery (the viral surface)

Each entry is a permalink with a one-line "trap → truth" caption and, where possible,
a live slider. Ship these on day one; they are the highest-leverage adoption feature.

Confounding (fork) · collider / Berkson selection · M-bias (adjusting a "reasonable"
pre-treatment covariate creates bias) · over-control (adjusting a mediator kills the
effect) · Simpson's paradox (trend reverses within strata) · frontdoor (backdoor
fails, frontdoor recovers) · IV / LATE (OLS biased, 2SLS recovers the complier
effect) · IV with broken exclusion (direct `Z→Y` edge; 2SLS biased despite a strong
first stage) · IV with broken monotonicity (defiers admitted; 2SLS's estimand stops
being a clean LATE) · nonlinear dose–response (recover `cos` with a flexible basis) ·
measurement error / attenuation · confidently-wrong CIs under misspecification.

---

## 14. Stack rationale (so nobody re-litigates it)

- **React Flow** over a hand-rolled SVG DAG: draggable node-link editing, auto-layout,
  huge adoption, MIT. A math-coordinate graphing component is the wrong abstraction
  for a node-link DAG.
- **MathLive** over hand-rolled input: accessible, mobile keyboards, LaTeX/MathJSON
  export, actively maintained; MathQuill is the older fallback.
- **mathjs** for parse/eval: mainstream and battle-tested; keep the DSL's own tokens
  in a thin line-grammar and delegate only expressions. Because permalinks let
  untrusted expressions reach any visitor's browser, construct a restricted
  `math.create()` instance (no `import`, no matrix/unit constructors) and enforce
  the identifier/function allow-list (§4.8 rule 6) as a security boundary, not
  just a UX nicety.
- **Plotly** for statistical/interactive plots (recharts as the lighter alternative).
- **Plain React state / small store** over a reactive-framework runtime: sufficient,
  well-understood, no heavy dependency.
- **All MIT/Apache-2.0** — clean to open-source under MIT and to deploy publicly with
  no copyleft obligations.

---

## 15. Positioning as portfolio / job-hunt evidence

Cheap moves that make this read as expert-grade rather than a class project:

- Put the cross-library validation table (section 10b) front and center in the README
  with green checks; link the generating scripts.
- Write a short methods page: the estimands, the identification strategies, the
  references, and *why* the ground truth is computed by mutilation. This is where you
  demonstrate you can explain, not just call, the methods — which is what interviews
  probe.
- This playground is the public artifact; the "more involved portfolio product" it
  seeds is a case-study series applying these same estimators to real datasets
  (e.g. the "What If" or a public policy dataset) with honest writeups. Reuse
  `scm-engine`/`estimators` so the two products share a spine.

---

## 16. Extension points (design for, don't build in v1)

Full Shpitser–Pearl ID (validate vs Ananke) · double/debiased ML, TMLE, causal
forests, S/T/X-learners · causal discovery mode (hide the graph, run PC/GES/LiNGAM/
NOTEARS, compare to truth — interacts with the noise model you already control) ·
time index for g-methods / MSMs / DiD / panel · selection-bias `restrict` clause ·
measurement error · sensitivity analysis (since true confounding strength is known,
show how E-values / Rosenbaum bounds / OVB recover it) · stochastic/conditional
interventions · quantile treatment effects.

---

## 17. Build order

- **Phase 0 — DSL.** Line-grammar + mathjs expressions, validation, `Model` IR.
  Deliverable: parse the four presets + one latent model into a validated IR with
  good errors.
- **Phase 1 — Engine + oracle.** Distributions, seeded RNG, forward + interventional
  sampling with mutilation and common random numbers. Deliverable: golden tests 1–4.
- **Phase 2 — Estimators + gate + comparison.** `naive`, `gcomp`, `stratify`, graph
  tests, identifiability gate, comparison view. Deliverable: golden test 5 + the
  confounding/collider/mediator/cos gallery end-to-end.
- **Phase 3 — Validation harness.** `validation/` vs DoWhy/EconML/statsmodels/dagitty
  with shipped fixtures. Deliverable: section 10b green in CI. **Do this early** — it
  is the credibility spine and catches estimator bugs before anyone else does.
- **Phase 4 — Hard identification + honest CIs.** `ipw`, `aipw`, `iv2sls` (with the
  LATE labeling), `frontdoor`; latents/`<->` through the graph tests; bootstrap CIs;
  Monte-Carlo mode. Deliverable: golden test 6 + validation rows for IPW/AIPW/IV/
  frontdoor.
- **Phase 5 — Product surface.** React Flow / MathLive / Plotly UI, the live-slider
  paradox gallery, permalinks, embeddable widget, code/CSV/SVG export, README with
  the validation table. Deliverable: shareable, embeddable, publishable.

Ship each phase behind its tests. Phases 0–1 and the Phase-3 validation harness are
load-bearing; the rest layers on a correct, cross-validated oracle.
