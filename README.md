# Causal Inference Playground

Write a structural causal model as equations, see its DAG, sample data from it, pick
an identification strategy, and compare your estimate against the **true causal
effect** — the one thing you never get with real data.

> `Y = cos(X) + A*B + eps`
> `X = C + eps`
> `C ~ Normal(0, 1)`
> `Y <-> ...` &nbsp;→&nbsp; DAG · sampled data · true `do(X)` curve vs. your estimate

**[▶ Live demo](https://TODO)** · **[Paradox gallery](https://TODO/gallery)** ·
**[Methods](./METHODS.md)** · **[Architecture](./ARCHITECTURE.md)**

<!-- TODO: replace with a short GIF of the confounding slider flipping the estimate -->

---

## Why it exists

Every real analysis has the same hole: you estimate a causal effect, but you can never
check it, because the counterfactual is unobserved. In a simulation you *do* have the
truth. This tool exploits that — it shows your estimate, the true interventional
answer, the bias between them, and *which open path* caused the bias.

The truth is computed the correct way: by intervening on the graph — fixing the
treatment, cutting its incoming edges, and resampling everything downstream — **never**
by reading the estimand off the equation. That distinction is the point, and it is
explained in [METHODS.md](./METHODS.md).

## Try these

Each link opens a fully-specified model; every state in the app is a permalink.

- **Confounding** — a naive fit is biased; adjust for the confounder to recover the truth. `[link]`
- **Collider / M-bias** — adjusting a "reasonable" covariate *creates* bias. `[link]`
- **Over-control** — adjusting a mediator erases the effect you're measuring. `[link]`
- **Simpson's paradox** — the trend reverses inside every stratum. `[link]`
- **Front-door** — back-door adjustment fails; front-door recovers the effect. `[link]`
- **IV / LATE** — OLS is biased; 2SLS recovers the complier effect. `[link]`
- **Nonlinear dose–response** — recover a cosine with a flexible basis. `[link]`

## Validation

Every estimator and every graph-level identification result is checked against the
reference implementations the field already trusts, on canonical problems, within
Monte-Carlo tolerance. Fixtures (expected values, precomputed) are committed to the
repo, so the suite runs in CI without a Python runtime; the scripts that generate them
are kept in-repo for provenance.

```bash
npm run validate        # runs packages/validation against committed fixtures
```

| What                            | Checked against                         | Asserted                          |
|---------------------------------|-----------------------------------------|-----------------------------------|
| Back-door ATE (confounding)     | DoWhy · statsmodels OLS                 | point estimate + CI               |
| g-computation dose–response     | statsmodels (flexible basis)            | curve within tolerance            |
| IPW / AIPW ATE                  | DoWhy · EconML                          | point estimate                    |
| IV / 2SLS (LATE)                | linearmodels `IV2SLS`                   | coefficient + first-stage F       |
| Front-door adjustment           | DoWhy front-door                        | point estimate                    |
| d-separation & adjustment sets  | dagitty                                 | set membership + testable implic. |
| Worked examples                 | Hernán & Robins, *What If* datasets     | published effect estimates        |

A concrete example already verified in the reference engine — the confounding model
`C ~ N(0,1); X = 1.5C + eps; Y = 2X + 3C + eps`, whose true effect of `X` on `Y` is
exactly **2.0**:

| estimator                 | estimate | matches |
|---------------------------|---------:|:-------:|
| naive (unadjusted)        |    3.38  | biased (expected) |
| g-computation, adjust {C} |    2.01  | ✓ true effect |
| interventional oracle     |    2.01  | ✓ true effect |

The oracle (graph mutilation + resampling) and the adjusted estimator agree with the
analytic truth, and the naive estimator is biased by exactly the confounding term —
which is the whole demonstration, made checkable.

> Why this matters: the audience for this tool will probe it. Matching DoWhy, EconML,
> and dagitty within tolerance is what makes "here is the true effect" a claim rather
> than a hope.

## What it does

- **A small SCM language** with deterministic (`=`) and stochastic (`~`) nodes,
  per-equation independent noise, latent variables, and bidirected edges (`<->`) for
  unobserved confounding.
- **A correct interventional oracle** — `do(X=x)` by graph mutilation, with common
  random numbers for smooth ground-truth curves.
- **Estimators** from a naive baseline through g-computation, stratification, IPW,
  doubly-robust AIPW, IV/2SLS (with honest LATE labeling), and front-door.
- **An identifiability gate** that tells you whether a strategy is even valid on your
  graph — and lets you override it to *watch* the failure.
- **Monte-Carlo mode** — repeat the whole pipeline and see the sampling distribution of
  your estimate: bias, RMSE, and CI coverage.
- **Shareable everything** — models, queries, and seeds serialize into the URL; export
  to CSV, SVG, and runnable Python/R.

## How it works

The engine is described in [ARCHITECTURE.md](./ARCHITECTURE.md); the statistics and
their assumptions in [METHODS.md](./METHODS.md). In short: a parsed model becomes an
immutable IR; a seeded engine samples it and produces interventional ground truth; the
estimators see only the *observed* columns (latents are stripped), so the hard problems
are hard for them for the same reason they are hard in reality.

## Packages

The engine and estimators carry no UI dependency and are published standalone:

- `@TODO/scm-engine` — SCM IR, distributions, forward and interventional sampling.
- `@TODO/causal-estimators` — the estimators and the identifiability gate.

## Develop

```bash
npm install
npm run dev        # app at http://localhost:5173
npm test           # golden tests
npm run validate   # cross-library validation
```

Stack: React · React Flow (DAG) · MathLive (equation input) · mathjs (parsing) ·
Plotly (charts). All MIT / Apache-2.0.

## License

MIT.

## Citing / further reading

The methods and their sources are listed in [METHODS.md](./METHODS.md) — Pearl,
Hernán & Robins, Imbens & Rubin, and the primary papers behind each estimator.
