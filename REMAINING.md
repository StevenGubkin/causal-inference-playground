# Remains to be implemented

A single running list of what's *not* built yet, kept next to the code instead of
scattered across README/ARCHITECTURE/METHODS notes. This file is reviewed and updated
as part of every push — see `CLAUDE.md`.

Last reviewed: 2026-08-08 (validation table complete — swapped the deferred
Hernán & Robins worked-example gap for an IHDP benchmark fixture instead).

## Near-term (tracked in ARCHITECTURE.md, expected to ship)

- **Embeddable `<iframe>`/web-component widget** — not started. The only item
  left on this list; the validation table (README) is now fully ✅.

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
