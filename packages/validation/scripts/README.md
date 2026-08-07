# Fixture generators

ARCHITECTURE.md §10b. Python scripts that compute expected values against
DoWhy, statsmodels, and linearmodels for each canonical problem, writing the
results into `../fixtures/`. They run out-of-band (not part of
`npm run validate`, which only checks the already-committed fixtures) and
are kept here for provenance.

## Setup

An isolated environment, managed by [`uv`](https://docs.astral.sh/uv/), lives
in `packages/validation/.venv` — this never touches your system or base conda
Python.

```bash
cd packages/validation
uv sync                 # creates .venv, installs numpy/pandas/dowhy/statsmodels/linearmodels/networkx/econml
```

## Regenerating a fixture

```bash
uv run python scripts/generate_backdoor_fixture.py
uv run python scripts/generate_iv_fixture.py
uv run python scripts/generate_frontdoor_fixture.py
uv run python scripts/generate_gcomp_nonlinear_fixture.py
uv run python scripts/generate_ipw_fixture.py
uv run python scripts/generate_dsep_fixture.py
uv run python scripts/generate_testable_implications_fixture.py
```

Each numeric-estimator script replicates the corresponding `.scm` model's
DGP directly in numpy (not by calling our own parser — the whole point is an
independent implementation), runs the reference library, and overwrites the
matching `../fixtures/*.json`. `generate_dsep_fixture.py` is the exception —
d-separation is a property of the graph, not the data, so it has no DGP/
seed/N; it hand-builds the graph topology and checks it structurally.
Commit the updated fixture alongside whatever change motivated regenerating
it.

## What's covered so far

- `generate_backdoor_fixture.py` — confounding.scm vs. DoWhy
  (`backdoor.linear_regression`) and statsmodels OLS.
- `generate_iv_fixture.py` — iv-late.scm vs. linearmodels `IV2SLS`. The
  first-stage F is cross-checked via statsmodels' classical F for `D ~ 1 +
  Z` directly, not linearmodels' own `first_stage` diagnostic — that one is
  heteroskedasticity-robust and chi²-distributed by default, a different
  statistic from the classical F our TypeScript implementation computes, so
  comparing against it directly would be apples-to-oranges.
- `generate_frontdoor_fixture.py` — frontdoor.scm's two-stage regression
  (`M ~ X`, then `Y ~ M + X`) vs. statsmodels OLS, plus DoWhy used
  structurally only (`identify_effect().get_frontdoor_variables()`) to
  confirm it identifies `M` as the front-door variable. **Not** DoWhy's own
  `frontdoor.two_stage_regression` numeric estimate — as of `dowhy==0.14`
  that estimator has a real bug where its second-stage regression silently
  drops the required adjustment for `X` (it looks up the wrong
  `identifier_method` key internally), giving a biased number. See the
  script's docstring for the full trace; don't "fix" the fixture back
  toward that biased value later.
- `generate_dsep_fixture.py` — backdoor-criterion validity
  (`backdoorValid`) and minimal adjustment sets (`findBackdoorSet`) for
  confounding.scm/collider.scm/mediator.scm, plus the inline M-bias graph
  from `packages/graph/src/backdoor.test.ts`, vs. networkx's
  `is_d_separator`. ARCHITECTURE.md names dagitty (an R package) for this
  row; this uses networkx instead — same moralization algorithm dagitty and
  our own `dsep.ts` both use, no second language toolchain needed, and it
  already ships transitively via DoWhy. Covers set membership only — see
  `generate_testable_implications_fixture.py` below for the "implied CI
  statements" half.
- `generate_gcomp_nonlinear_fixture.py` — nonlinear.scm's flexible
  (degree-6 polynomial) basis g-formula vs. statsmodels, at a grid of
  points, plus the closed-form truth (`cos(x)`, exact here since `C`'s
  contribution integrates to a constant offset independent of the
  intervention).
- `generate_ipw_fixture.py` — ipw-confounding.scm's IPW/AIPW ATE vs. DoWhy's
  `backdoor.propensity_score_weighting` and EconML's `LinearDRLearner`
  (doubly robust). Needs `econml` (in `pyproject.toml` since this fixture
  was added).
- `generate_testable_implications_fixture.py` — for every non-adjacent pair
  of observed nodes in the same four models `generate_dsep_fixture.py`
  covers, one minimal d-separating set via networkx's
  `find_minimal_d_separator(G, x, y, restricted=observed)`, cross-checked
  against `packages/graph/src/testable-implications.ts`. Existence
  agreement plus re-validating networkx's chosen separator against our own
  `dSeparated` — not exact-set equality, since a graph can have multiple
  valid minimal separators and the two implementations' searches have no
  reason to pick the same one (see the script's docstring).

Not yet implemented: the Hernán & Robins "What If" worked examples (needs
sourcing/licensing the actual published datasets, and a CSV-loading path
that bypasses the SCM/oracle framework entirely — a real dataset has no
synthetic DGP to check estimators against, just the book's own published
number).
