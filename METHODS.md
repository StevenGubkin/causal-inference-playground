# Methods

This document states precisely what the playground computes and why. It is the
reference for the claims the tool makes on screen, and the place where the
identification assumptions behind each strategy are spelled out. Notation follows
Pearl for graphs and Hernán & Robins for estimands; full references are at the end.

## 1. The distinction the whole tool is built on

For a treatment `X` and outcome `Y`, two quantities are easy to conflate and are
almost never equal:

- The **observational** regression `E[Y | X = x]` — the average outcome *among units
  that happen to have* `X = x`. This is what a naive fit of `Y` on `X` recovers.
- The **interventional** dose–response `E[Y | do(X = x)]` — the average outcome *if we
  set* `X = x` for everyone. This is the causal quantity.

They differ whenever conditioning on `X` carries information about other causes of
`Y`, i.e. whenever there is an open back-door path between `X` and `Y`. The gap
between them is confounding, and closing it correctly is the entire problem of causal
inference. The playground always shows both, and never labels the observational curve
"truth."

The `do`-operator is Pearl's graph surgery: `do(X = x)` deletes the edges *into* `X`
(so `X` no longer listens to its usual causes), fixes `X = x`, and leaves every other
structural mechanism unchanged. The interventional distribution is the distribution
induced by this mutilated model.

## 2. Why the oracle *simulates* the mutilated graph instead of evaluating the formula

The tool knows the data-generating mechanism exactly — for the cos example,
`Y = cos(X) + A·B + ε`. It is tempting to read the causal curve straight off that
equation. That is wrong, for a reason worth stating carefully.

The estimand is an **average over the interventional distribution of everything else
that feeds `Y`**:

```
m(x) = E[ f_Y( pa(Y) ; ε_Y ) | do(X = x) ]
```

where `pa(Y)` are the parents of `Y`. Under `do(X = x)`, those parents split in two:
parents that are **descendants of `X`** take new values (they are recomputed with `X`
fixed), while parents that are **non-descendants of `X`** keep their natural
(observational) marginal, because intervening on `X` does not touch their ancestors.
The average is over that *interventional* joint distribution — which is neither the
observational conditional `P(pa(Y) | X = x)` nor a matter of plugging in observational
conditional means.

Evaluating the formula naively goes wrong in exactly the way the tool exists to
expose: substitute `E[covariate | X = x]` (an observational conditional, contaminated
by the back-door path) and you reproduce the confounded answer. Getting it right in
closed form means propagating the intervention through every mediator and descendant
downstream — a slog for anything past linear-Gaussian, and error-prone.

Simulating the mutilated graph does the correct marginalization automatically: cut the
edges into `X`, fix `X = x`, resample every other node from the original mechanisms,
average `Y`. What comes back is a draw from the true interventional distribution, so
the average is `m(x)` up to Monte-Carlo error, and it is robust to nonlinearity,
mediators, and descendants without any special-casing.

There is a second reason, specific to a *validation* tool. The oracle must be an
**independent** source of truth from the estimators. If it computed the estimand with
the same conditional-expectation machinery the estimators use, a bug could live in
both and cancel, hiding itself. Forward simulation of the mutilated graph uses only
the generating mechanisms — no estimation logic — so a mismatch between an estimator
and the oracle is real signal, not a shared artifact. That independence is what makes
"compare your estimate to the truth" trustworthy, and it is why the architecture keeps
the oracle and the estimators strictly separate.

**Variance reduction (common random numbers).** Across the grid of `x` values, the
oracle reuses one frozen draw of all exogenous noise and changes only the intervened
node and its descendants. Adjacent points then share their randomness, so the
ground-truth curve moves as a coherent whole instead of jittering, and slopes and
contrasts computed off it have far lower variance. Only the intervened mechanism and
what depends on it are recomputed.

## 3. The estimand is a choice

The causal question is not implicit; the user picks it, and the estimator and the
comparison adapt:

- **ATE** — average treatment effect, `E[Y | do(X=b)] − E[Y | do(X=a)]`.
- **ATT** — the same contrast among the treated.
- **Dose–response** — the whole curve `x ↦ E[Y | do(X=x)]`, for continuous treatment.
- **CATE** — the effect as a function of covariates, `E[Y | do(X=x), Z=z]`.

Comparisons are always estimand-appropriate: a dose–response estimate is compared to
the interventional curve, an ATE to the interventional contrast. The observational
curve appears as a third reference only.

## 4. Identification strategies

Each strategy answers "under what assumptions is the causal estimand a function of the
observable distribution, and what function?" The tool checks each assumption against
the graph before offering the strategy, and lets the user override to see the failure.

### Back-door adjustment / the g-formula

*Assumption.* A set `Z` satisfies the **back-door criterion** relative to `(X, Y)`: no
node in `Z` is a descendant of `X`, and `Z` blocks every back-door path from `X` to
`Y`.

*Estimand.* Then

```
E[Y | do(X=x)] = Σ_z E[Y | X=x, Z=z] · P(Z=z)        (integral in the continuous case)
```

*Estimation.* Fit an outcome model `E[Y | X, Z]`, predict it at `(x, Z_i)` for every
observed `Z_i`, and average over `i` (g-computation). A flexible basis in `X`
(polynomial, splines) is what lets the estimate recover a nonlinear dose–response such
as a cosine. The naive estimator is the same fit with `Z` omitted; the gap between
them is the confounding bias.

*Trap the tool demonstrates.* Adjusting for a **collider** or a **descendant of `X`**
(a mediator) is *not* back-door-valid: adjusting a collider opens a spurious path
(M-bias, Berkson selection), and adjusting a mediator removes part of the very effect
you are estimating (over-control). The gate flags both.

### Stratification

The exact back-door formula above when `Z` is discrete and low-cardinality: estimate
`E[Y | X=x, Z=z]` within each stratum and average with weights `P(Z=z)`.

### Inverse-probability weighting (IPW)

*Assumption.* Back-door `Z` plus **positivity/overlap**: every unit has nonzero
probability of each treatment level given `Z`.

*Estimand.* Reweight the sample by the inverse of the (generalized) propensity score
`P(X=x | Z)` so that treatment is independent of `Z` in the pseudo-population, then
read the effect off the reweighted data.

*Diagnostic.* When overlap is poor, a few units get enormous weights and the estimate
becomes unstable; the tool surfaces the minimum overlap and the effective sample size.

### Doubly-robust estimation (AIPW)

*Assumption.* Back-door `Z`, and *either* the outcome model *or* the propensity model
correctly specified.

*Property.* Augmented IPW combines both models so the estimate is consistent if at
least one is right — **double robustness** — and is semiparametrically efficient when
both are. This is the honest workhorse: it forgives one modeling mistake.

### Instrumental variables (2SLS)

*Assumption.* When `X ↔ Y` confounding is **unobserved** (no valid back-door set
exists), an instrument `Z` can still identify an effect if it is **relevant** (affects
`X`), satisfies **exclusion** (affects `Y` only through `X`), and is **independent of
the unobserved confounders**.

*Estimand — read this carefully.* Two-stage least squares recovers the ATE **only**
under constant/linear treatment effects. Under effect **heterogeneity** with a binary
instrument and a **monotonicity** assumption, it identifies the **Local Average
Treatment Effect (LATE)** — the average effect *among compliers*, not the population.
The tool labels the 2SLS result accordingly and, when the generating model has
heterogeneous effects, shows explicitly that the LATE differs from the population ATE
the oracle computes. Conflating the two is the most common IV error; the tool refuses
to.

*Diagnostic.* The first-stage F statistic flags weak instruments, where 2SLS is biased
toward the confounded OLS estimate.

### Worked construction: compliance heterogeneity

The LATE story above only becomes concrete once the model has units whose
treatment *response to the instrument* actually varies — plain compliance
noise isn't enough. The standard device is to give each unit two latent
potential-treatment values, `D(0)` and `D(1)` — what they would do under each
instrument level — as parents of the observed treatment, rather than modeling
"compliance type" as a categorical draw:

```
latent U        ~ Normal(0, 1)
latent D0       ~ Bernoulli(logistic(a0 + a1*U))
latent D1extra  ~ Bernoulli(logistic(b0 + b1*U))
latent D1       = max(D0, D1extra)
Z               ~ Bernoulli(0.5)
D               = D0 + (D1 - D0)*Z
Y               = c0 + (tauAT*D0*D1 + tauC*(1-D0)*D1)*D + gamma*U + eps
```

- **Monotonicity is structural.** `D1 = max(D0, D1extra)` forces `D1 ≥ D0`
  for every unit, so defiers cannot exist — the assumption doesn't need to be
  policed, it falls out of the equation.
- **Exclusion is structural.** `Z` appears only in `D`'s equation, never in
  `Y`'s; the graph cannot violate exclusion unless an edge is added.
- **Confounding is real.** `U` drives both compliance behavior and `Y`
  directly, so the naive/OLS estimate is biased and an instrument is needed.
- **Heterogeneity falls out of the `D0`, `D1` interaction terms.**
  `(1-D0)*D1` is 1 only for compliers, `D0*D1` only for always-takers;
  never-takers have `D=0` under any `Z`, so their `tau` term never
  activates — matching the fact that their response is structurally
  unobservable, not just unidentified.

With `tauAT ≠ tauC`, `oracle.doContrast` (which mutilates `D` directly and
therefore averages `tau` over the *whole* population) and 2SLS (which
recovers `E[tau | complier]`) visibly diverge, and the reason — always-takers
and never-takers are invisible to the instrument — is inspectable in the
model itself.

Two variants of this same skeleton are worth shipping as gallery entries in
their own right (see ARCHITECTURE.md §13): add a direct `Z → Y` edge to break
exclusion (2SLS biased despite a strong first stage), or replace
`D1 = max(D0, D1extra)` with an independent `D1 ~ Bernoulli(...)` to admit
defiers and break monotonicity (2SLS's estimand stops being a clean LATE).

### Front-door adjustment

*Assumption.* Unobserved `X ↔ Y` confounding, but a mediator set `M` that fully
mediates `X → Y`, with no unblocked back-door path into `M` from `X`, and the only
back-door from `M` to `Y` running through `X`.

*Estimand.*

```
E[Y | do(X=x)] = Σ_m P(M=m | X=x) · Σ_{x'} E[Y | M=m, X=x'] · P(X=x')
```

Intuitively: identify `X → M` (clean, no confounding into `M`) and `M → Y` (adjusting
for `X`), then chain them. The tool demonstrates the case where back-door fails
outright and front-door recovers the effect.

## 5. Uncertainty, honestly

Confidence intervals come from the actual sampling variability — the nonparametric
bootstrap by default, analytic forms where they are exact — not from the residuals of
a model assumed to be correct. This is deliberate. It lets the tool demonstrate the
failure mode that matters most in practice: a **misspecified** estimator can produce a
**tight** interval that **confidently excludes the truth**. In Monte-Carlo mode the
tool reports interval **coverage** — the fraction of repeated samples whose CI contains
the true effect — which is the honest scorecard: a well-behaved 95% interval covers
about 95% of the time, and a confidently-wrong one covers far less.

## 6. Scope

Covered: acyclic models; continuous and discrete/stochastic outcomes; observed and
latent variables; atomic interventions; the estimands and strategies above; back-door,
front-door, and single-instrument identification checks validated against dagitty.

Not yet covered (see the architecture's extension section): the general
Shpitser–Pearl identification algorithm for arbitrary latent structure; double/debiased
ML, TMLE, and causal forests; causal discovery; time-varying treatment and the
g-methods; selection bias by design; measurement error; and formal sensitivity
analysis.

## References

- Pearl, J. (1995). *Causal diagrams for empirical research.* Biometrika 82(4).
- Pearl, J. (2009). *Causality: Models, Reasoning, and Inference,* 2nd ed. Cambridge.
- Hernán, M. A., & Robins, J. M. (2020). *Causal Inference: What If.* CRC Press.
- Robins, J. (1986). *A new approach to causal inference in mortality studies…*
  (the g-formula). Mathematical Modelling 7.
- Rosenbaum, P., & Rubin, D. (1983). *The central role of the propensity score in
  observational studies for causal effects.* Biometrika 70(1).
- Imbens, G., & Angrist, J. (1994). *Identification and estimation of local average
  treatment effects.* Econometrica 62(2).
- Angrist, J., Imbens, G., & Rubin, D. (1996). *Identification of causal effects using
  instrumental variables.* JASA 91(434).
- Bang, H., & Robins, J. (2005). *Doubly robust estimation in missing data and causal
  inference models.* Biometrics 61(4).
- Tian, J., & Pearl, J. (2002). *A general identification condition for causal
  effects.* AAAI.
- Shpitser, I., & Pearl, J. (2006). *Identification of joint interventional
  distributions in recursive semi-Markovian causal models.* AAAI.
- Chernozhukov, V., et al. (2018). *Double/debiased machine learning for treatment and
  structural parameters.* The Econometrics Journal 21(1).
- Textor, J., et al. (2016). *Robust causal inference using directed acyclic graphs:
  the R package 'dagitty'.* International Journal of Epidemiology 45(6).
- Imbens, G., & Rubin, D. (2015). *Causal Inference for Statistics, Social, and
  Biomedical Sciences.* Cambridge.
