"""ARCHITECTURE.md §10b -- front-door adjustment cross-check.

Replicates frontdoor.scm's DGP directly in numpy (U confounds X and Y but is
latent, so no valid backdoor set exists; M cleanly mediates X's effect on Y)
and computes the two-stage regression (M ~ X, then Y ~ M + X) via
statsmodels directly, as an independent reference implementation of our own
frontdoor.ts.

IMPORTANT -- do not use DoWhy's estimate_effect(..., method_name=
"frontdoor.two_stage_regression").value as the reference number. As of
dowhy==0.14, TwoStageRegressionEstimator has a real bug: its second-stage
regression is supposed to adjust for X (DoWhy's own identify_effect()
correctly computes this -- get_frontdoor_variables() returns ['M'] and the
identified estimand's mediation_second_stage_confounders correctly includes
'X' under the 'backdoor2'/'backdoor3' keys), but the estimator internally
hardcodes identifier_method = "backdoor" before looking up the confounder
set, which is always the *empty* list for this identification path -- so it
silently fits Y ~ M with no adjustment for X. Confirmed by hand: DoWhy's
returned estimate is bit-for-bit identical to a plain unadjusted
statsmodels.OLS(Y, [const, M]) fit, and differs from the correctly-adjusted
two-stage estimate by a wide margin (~6.45 vs ~6.0 on this DGP). DoWhy is
still used below, but only to confirm it *identifies* M as the front-door
variable structurally -- not for the numeric estimate. Do not "fix" this
fixture by switching back to DoWhy's number.

Run via `uv run python scripts/generate_frontdoor_fixture.py` from
packages/validation/. Writes fixtures/frontdoor-adjustment.json.
"""

import json
from pathlib import Path

import networkx as nx
import numpy as np
import pandas as pd
import statsmodels.api as sm
from dowhy import CausalModel

SEED = 20260803
N = 20000


def main() -> None:
    rng = np.random.default_rng(SEED)
    u = rng.normal(0, 1, N)
    x = 2 * u + rng.normal(0, 1, N)
    m = 2 * x + rng.normal(0, 1, N)
    y = 3 * m + 5 * u + rng.normal(0, 1, N)

    # Naive: Y ~ X (badly biased -- U is an unobserved confounder).
    naive_fit = sm.OLS(y, sm.add_constant(x)).fit()
    naive_slope = float(naive_fit.params[1])

    # Stage 1: M ~ X.
    stage1 = sm.OLS(m, sm.add_constant(x)).fit()
    stage1_coef = float(stage1.params[1])

    # Stage 2: Y ~ M + X (X adjusts away the only M->Y backdoor path).
    stage2 = sm.OLS(y, sm.add_constant(np.column_stack([m, x]))).fit()
    stage2_coef_mediator = float(stage2.params[1])
    stage2_coef_treatment = float(stage2.params[2])

    frontdoor_estimate = stage1_coef * stage2_coef_mediator

    # DoWhy: structural identification check only (see module docstring for
    # why its numeric estimate is not used). Pass a networkx DiGraph
    # directly rather than a dot-format string -- DoWhy's dot-string parser
    # hits a real pygraphviz/pydot incompatibility in this environment
    # (confirmed: `Graph.get_strict() takes 1 positional argument but 2
    # were given`, a known pydot/networkx version mismatch), same class of
    # issue generate_backdoor_fixture.py's common_causes workaround avoids.
    graph = nx.DiGraph()
    graph.add_edges_from([("U", "X"), ("U", "Y"), ("X", "M"), ("M", "Y")])
    model = CausalModel(
        data=pd.DataFrame({"X": x, "Y": y, "M": m}),
        treatment="X",
        outcome="Y",
        graph=graph,
    )
    identified = model.identify_effect()
    dowhy_frontdoor_variables = identified.get_frontdoor_variables()

    fixture = {
        "problem": "front-door adjustment (frontdoor.scm)",
        "dgp": "latent U ~ Normal(0,1); X = 2*U + eps; M = 2*X + eps; Y = 3*M + 5*U + eps",
        "n": N,
        "seed": SEED,
        "naive_ols_slope": naive_slope,
        "stage1_coef": stage1_coef,
        "stage2_coef_mediator": stage2_coef_mediator,
        "stage2_coef_treatment": stage2_coef_treatment,
        "frontdoor_estimate": frontdoor_estimate,
        "true_effect": 6.0,
        "dowhy_frontdoor_variables": dowhy_frontdoor_variables,
        "references": {
            "statsmodels": __import__("statsmodels").__version__,
            "dowhy": __import__("dowhy").__version__,
        },
    }

    out_path = Path(__file__).parent.parent / "fixtures" / "frontdoor-adjustment.json"
    out_path.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {out_path}")
    print(json.dumps(fixture, indent=2))


if __name__ == "__main__":
    main()
