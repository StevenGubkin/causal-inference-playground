# Causal Inference Playground

Write a structural causal model as equations, see its DAG, sample data from it, pick
an identification strategy, and compare your estimate against the **true causal
effect** — the one thing you never get with real data.

> `Y = cos(X) + A*B + eps`
> `X = C + eps`
> `C ~ Normal(0, 1)`
> `Y <-> ...` &nbsp;→&nbsp; DAG · sampled data · true `do(X)` curve vs. your estimate

**[▶ Live demo](https://stevengubkin.github.io/causal-inference-playground/)** ·
**[Examples](https://stevengubkin.github.io/causal-inference-playground/#/examples)** ·
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

Each link opens a fully-specified example model in the live app. Every one of these —
and any state you build yourself in Freeform, or a preset you've modified — is also a
shareable permalink: the "copy permalink" button compresses the current model, query,
and seed into the URL.

- **[Confounding](https://stevengubkin.github.io/causal-inference-playground/#/examples/confounding)** — a naive fit is biased; adjust for the confounder to recover the truth.
- **[Collider / M-bias](https://stevengubkin.github.io/causal-inference-playground/#/examples/collider)** — adjusting a "reasonable" covariate *creates* bias.
- **[Over-control](https://stevengubkin.github.io/causal-inference-playground/#/examples/mediator)** — adjusting a mediator erases the effect you're measuring.
- **[Simpson's paradox](https://stevengubkin.github.io/causal-inference-playground/#/examples/simpson)** — the trend reverses inside every stratum.
- **[IV / LATE](https://stevengubkin.github.io/causal-inference-playground/#/examples/iv-late)** — OLS is biased; 2SLS recovers the complier effect.
- **[Nonlinear dose–response](https://stevengubkin.github.io/causal-inference-playground/#/examples/nonlinear)** — recover a cosine with a flexible basis.
- **[Front-door adjustment](https://stevengubkin.github.io/causal-inference-playground/#/examples/frontdoor)** — no valid backdoor set exists (the confounder is unobserved); adjust via a mediator instead.
- **[Propensity score (IPW / AIPW)](https://stevengubkin.github.io/causal-inference-playground/#/examples/ipw-confounding)** — a binary treatment confounded by `Z`; naive is biased, IPW/AIPW reweight by `P(X=1|Z)` to recover the truth.

## Validation

Every estimator and every graph-level identification result is checked against the
reference implementations the field already trusts, on canonical problems, within
Monte-Carlo tolerance. Fixtures (expected values, precomputed) are committed to the
repo, so the suite runs in CI without a Python runtime; the scripts that generate them
(`packages/validation/scripts/`, run via `uv sync && uv run python scripts/generate_*.py`
from `packages/validation/`) are kept in-repo for provenance.

```bash
npm run validate        # runs packages/validation against committed fixtures
```

| What                            | Checked against                         | Asserted                          | Status |
|---------------------------------|------------------------------------------|-----------------------------------|:---:|
| Back-door ATE (confounding)     | DoWhy · statsmodels OLS                 | point estimate + CI               | ✅ |
| IV / 2SLS (LATE)                | linearmodels `IV2SLS`                   | coefficient + classical first-stage F | ✅ |
| d-separation & backdoor sets    | networkx `is_d_separator`               | set membership (validity + minimal set) | ✅ |
| Front-door adjustment           | statsmodels two-stage OLS · DoWhy (structural ID only) | point estimate | ✅ |
| g-computation dose–response     | statsmodels (flexible basis)            | curve within tolerance            | ✅ |
| IPW / AIPW ATE                  | DoWhy · EconML                          | point estimate                    | ✅ |
| Graph testable implications     | networkx `find_minimal_d_separator`     | implied CI statements             | ✅ |
| Worked examples                 | Hernán & Robins, *What If* datasets     | published effect estimates        | planned |

Three concrete examples, verified against independent reference implementations, not
just our own internal tests:

**Confounding** — `C ~ N(0,1); X = 1.5C + eps; Y = 2X + 3C + eps`, true effect of `X`
on `Y` is exactly **2.0**:

| estimator                 | estimate | matches DoWhy/statsmodels |
|---------------------------|---------:|:-------:|
| naive (unadjusted)        |    3.38  | biased (expected) |
| g-computation, adjust {C} |    2.01  | ✓ (diff < 0.01) |

**IV/LATE** — the compliance-heterogeneity construction in [METHODS.md](./METHODS.md),
where 2SLS should recover the *complier* effect (3.0), not the population ATE (~1.45):

| estimator      | estimate | matches linearmodels `IV2SLS` |
|-----------------|---------:|:-------:|
| naive           |     n/a  | biased (confounded by U) |
| 2SLS (LATE)     |    3.05  | ✓ (diff < 0.06) |

**Front-door** — `U` confounds `X` and `Y` but is unobserved, so no valid backdoor set
exists; `X = 2U+eps; M = 2X+eps; Y = 3M+5U+eps`, true effect of `X` on `Y` is exactly
**6.0**:

| estimator            | estimate | matches statsmodels two-stage OLS |
|-----------------------|---------:|:-------:|
| naive (unadjusted)    |     8.01 | biased (confounded by U) |
| front-door, via {M}   |     5.98 | ✓ (diff < 0.03) |

(Cross-checking this one caught a real bug in `dowhy==0.14`'s own front-door
estimator — its second-stage regression silently drops the required adjustment for
`X`. See `packages/validation/scripts/generate_frontdoor_fixture.py` for the trace;
DoWhy is still used to confirm *identification*, just not for the numeric estimate.)

The oracle (graph mutilation + resampling) and the adjusted estimators agree with the
analytic truth and with independent Python reference implementations; the naive
estimator is biased in both cases exactly as the theory predicts — which is the whole
demonstration, made checkable.

> Why this matters: the audience for this tool will probe it. Matching DoWhy,
> linearmodels, EconML, and networkx within tolerance is what makes "here is the true
> effect" a claim rather than a hope.

## What it does

Working today:

- **A small SCM language** with deterministic (`=`) and stochastic (`~`) nodes,
  per-equation independent noise, latent variables, and bidirected edges (`<->`) for
  unobserved confounding.
- **A correct interventional oracle** — `do(X=x)` by graph mutilation, with common
  random numbers for smooth ground-truth curves. The DAG view marks exactly the
  edges `do(X=x)` cuts (in red, dashed) — always a strict subgraph of the original
  DAG, never anything more elaborate, since mutilation only ever means "don't
  evaluate the treatment's own equation."
- **Estimators**: naive (unadjusted), g-computation (polynomial or kernel-ridge/RBF
  basis, so it recovers nonlinear dose-response), stratification (for a discrete,
  low-cardinality adjustment set), IPW and doubly-robust AIPW (for a binary treatment,
  with propensity-overlap and effective-sample-size diagnostics), IV/2SLS with honest
  LATE-vs-ATE labeling, and front-door adjustment (for when the confounder is
  unobserved and no backdoor set exists at all).
- **A back-door, instrument, and front-door identifiability gate** that tells you
  whether a strategy is even valid on your graph — and lets you override it to *watch*
  the failure (collider bias, over-control, weak instruments, an invalid mediator).
- **Shareable permalinks** — any state, Freeform or a modified preset, compresses into
  a URL via "copy permalink." Decoding routes through the exact same DSL allow-list
  every other model source uses (no special trust for a link), with layered defenses
  against the resource-exhaustion surface compression adds — size caps and a
  statement-count cap, checked before any parsing — and a clean error banner on a
  malformed or incompatible-schema link rather than a crash.
- **Export**: model as `.scm`, sample as CSV, DAG as SVG, and generated runnable
  Python (statsmodels, plus real scikit-learn `KernelRidge`/`Logit` where the active
  view uses kernel-ridge g-comp or IPW/AIPW) reproducing the analysis on screen.
- **Monte Carlo mode** — for any ATE estimate, re-run the whole pipeline (fresh
  sample, every applicable estimator) up to 1000 times and see the *sampling
  distribution*, not just one point: a bias/RMSE readout and an overlaid histogram
  per estimator, each compared against the right truth (population ATE for
  naive/g-comp/stratify/IPW/AIPW/front-door, the complier LATE for 2SLS — the same
  distinction the single-run view already draws). Runs chunked on the main thread
  rather than a worker pool — a real benchmark showed replicates cost ~1–4ms each,
  so batching (with a live progress counter) keeps the UI responsive without the
  added complexity. An optional **CI coverage** check goes further: for each
  replicate, also bootstrap a small interval around *that replicate's own sample*
  and check whether it contains the truth — coverage lands near 95% for the
  well-specified estimators and dramatically below it for naive, METHODS.md's
  "confidently wrong" property made numeric. Deliberately leaner than the
  single-run panel below (percentile/basic only, no BCa — its jackknife pass would
  multiply an already `replicates × inner-resamples` cost into infeasibility) and
  off by default, since it's real added cost (seconds to tens of seconds).
- **Confidence intervals** — for any ATE estimate, a nonparametric bootstrap on your
  *actual sample* (not a fresh population draw, unlike Monte Carlo mode — this is
  what you could compute from real data alone), with a toggle between three interval
  flavors: percentile, basic/pivotal, and BCa (bias-corrected and accelerated). None
  strictly dominates the others — percentile is transformation-respecting, basic
  directly corrects a location bias via reflection, BCa gets both at the cost of an
  extra jackknife pass. Demonstrates METHODS.md's central point about honest
  uncertainty directly: naive's interval is tight *and excludes the true effect*,
  while the adjusted estimators' intervals correctly contain it.

See [REMAINING.md](./REMAINING.md) for the full list of what's not built yet
(kept current with every push). The Validation table below tracks what's
cross-checked against reference implementations as of today.

## How it works

The engine is described in [ARCHITECTURE.md](./ARCHITECTURE.md); the statistics and
their assumptions in [METHODS.md](./METHODS.md). In short: a parsed model becomes an
immutable IR; a seeded engine samples it and produces interventional ground truth; the
estimators see only the *observed* columns (latents are stripped), so the hard problems
are hard for them for the same reason they are hard in reality.

## Packages

`scm-engine` (SCM IR, distributions, forward and interventional sampling) and
`estimators` (the estimators and the identifiability gate) carry no UI dependency —
by design, not in service of publishing them standalone (not a goal; see
[REMAINING.md](./REMAINING.md)), but because it's what lets `packages/validation/`
exercise them directly, without `app`.

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
