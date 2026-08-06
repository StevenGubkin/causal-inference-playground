# Remains to be implemented

A single running list of what's *not* built yet, kept next to the code instead of
scattered across README/ARCHITECTURE/METHODS notes. This file is reviewed and updated
as part of every push — see `CLAUDE.md`.

Last reviewed: 2026-08-06 (through commit `6992366`, "Align docs with current
implementation state" — bootstrap CIs).

## Near-term (tracked in ARCHITECTURE.md, expected to ship)

- **CI coverage in Monte Carlo mode** — whether each replicate's own confidence
  interval actually contains the true effect. Needs a bootstrap nested inside every
  Monte Carlo replicate (40,000+ estimator calls at default settings), its own
  perf design the same way Monte Carlo mode's bias/RMSE and the single-run bootstrap
  CIs each needed one before shipping. (Single-run CIs — percentile/basic/BCa — are
  already shipped; this is specifically about coverage across repeated samples.)
- **Validation table gaps** (README's cross-library check, `packages/validation/`):
  - g-computation dose–response vs. statsmodels (flexible basis)
  - IPW/AIPW vs. DoWhy/EconML — estimator is built; the cross-library fixture isn't
    generated yet (needs a new `econml` Python dependency)
  - `testableImplications()` (graph package) vs. dagitty/networkx — function not
    implemented yet
  - Worked examples reproducing published Hernán & Robins (*What If*) effect
    estimates
- **Embeddable `<iframe>`/web-component widget** — not started.
- **npm publishing** of `scm-engine`/`estimators` as standalone packages — not
  started; `README.md`'s package names are still placeholders.

## Smaller gaps

- **Analytic (closed-form) confidence intervals** — METHODS.md calls for "the
  nonparametric bootstrap by default, analytic forms where they are exact." Only
  bootstrap (percentile/basic/BCa) is implemented; closed-form SEs for the OLS-based
  estimators (naive, gcomp) would be cheaper and exact where applicable, but weren't
  built — the bootstrap panel covers every estimator uniformly instead.
- **The live-slider signature interaction** — ARCHITECTURE.md §11 describes a
  gallery-model slider (confounding strength, selection rate, effect heterogeneity)
  where the estimate visibly flips sign or a CI stops covering the truth *while
  dragging*, with a two-tier update (cheap immediate recompute, then a debounced
  full recompute with bootstrap CIs). None of this exists — the app uses plain
  number inputs/checkboxes with a single debounced recompute, which real
  benchmarking has shown is fast enough without a live-drag fast path. The
  underlying demonstrations (Simpson reversal, M-bias, weak instruments) are all
  already reachable via the existing controls; only the "drag and watch it happen
  live" interaction itself was never built.

## Explicitly out of v1 scope (ARCHITECTURE.md §16 — design for, don't build)

Not being worked toward; listed so it's clear these are deliberate non-goals, not
oversights:

- The general Shpitser–Pearl `ID` algorithm (validate vs. Ananke)
- Double/debiased ML, TMLE, causal forests, S/T/X-learners
- Causal discovery mode (hide the graph, run PC/GES/LiNGAM/NOTEARS, compare to truth)
- Time index for g-methods / MSMs / DiD / panel data
- A selection-bias `restrict` clause
- Measurement error
- Sensitivity analysis (E-values / Rosenbaum bounds / omitted-variable bias)
- Stochastic/conditional interventions
- Quantile treatment effects
