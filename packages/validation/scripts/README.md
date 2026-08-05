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
uv sync                 # creates .venv, installs numpy/pandas/dowhy/statsmodels/linearmodels/networkx
```

## Regenerating a fixture

```bash
uv run python scripts/generate_backdoor_fixture.py
uv run python scripts/generate_iv_fixture.py
uv run python scripts/generate_frontdoor_fixture.py
uv run python scripts/generate_dsep_fixture.py
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
  already ships transitively via DoWhy. Covers set membership only; the
  "testable implications" (implied CI statements) half of ARCHITECTURE.md
  §9's `testableImplications()` isn't implemented in `packages/graph` yet,
  so there's nothing to cross-check there so far.

Not yet implemented: g-computation's flexible basis vs. statsmodels, IPW/AIPW
vs. DoWhy/EconML (no `ipw`/`aipw` estimator exists yet to validate), graph
testable implications (needs `testableImplications()` implemented first),
and the Hernán & Robins "What If" worked examples (needs sourcing/licensing
the actual published datasets).
