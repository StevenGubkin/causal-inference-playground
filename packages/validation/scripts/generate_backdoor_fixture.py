"""ARCHITECTURE.md §10b -- backdoor ATE cross-check.

Replicates confounding.scm's DGP directly in numpy (C~N(0,1); X=1.5C+eps;
Y=2X+3C+eps, eps~N(0,1) per node) and computes the same three numbers our
own TypeScript pipeline computes -- naive OLS, backdoor-adjusted OLS, and
the interventional truth -- but here against DoWhy + statsmodels as an
independent reference implementation, per the "oracle must be an
independent source of truth" argument in METHODS.md §2 extended to the
estimators themselves.

Run via `uv run python scripts/generate_backdoor_fixture.py` from
packages/validation/. Writes fixtures/backdoor-confounding.json, committed
so `npm run validate` can check against it without a Python runtime.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
from dowhy import CausalModel

SEED = 20260801
N = 20000


def main() -> None:
    rng = np.random.default_rng(SEED)
    c = rng.normal(0, 1, N)
    x = 1.5 * c + rng.normal(0, 1, N)
    y = 2 * x + 3 * c + rng.normal(0, 1, N)

    # Naive: Y ~ X.
    naive_fit = sm.OLS(y, sm.add_constant(x)).fit()
    naive_slope = float(naive_fit.params[1])

    # Backdoor-adjusted: Y ~ X + C.
    adjusted_fit = sm.OLS(y, sm.add_constant(np.column_stack([x, c]))).fit()
    adjusted_slope = float(adjusted_fit.params[1])

    # DoWhy: identify + estimate via the same backdoor set, as an
    # independent cross-check of the statsmodels number above (common_causes
    # sidesteps DoWhy's dot-string graph parser, which hits an unrelated
    # pydot/networkx version incompatibility -- not needed here since the
    # confounder is already known from the DSL).
    model = CausalModel(
        data=pd.DataFrame({"X": x, "Y": y, "C": c}),
        treatment="X",
        outcome="Y",
        common_causes=["C"],
    )
    identified = model.identify_effect()
    dowhy_estimate = model.estimate_effect(
        identified,
        method_name="backdoor.linear_regression",
        confidence_intervals=True,
    )
    ci = dowhy_estimate.get_confidence_intervals()[0]

    fixture = {
        "problem": "backdoor ATE (confounding.scm)",
        "dgp": "C ~ Normal(0,1); X = 1.5*C + eps; Y = 2*X + 3*C + eps",
        "n": N,
        "seed": SEED,
        "naive_ols_slope": naive_slope,
        "backdoor_adjusted_ols_slope": adjusted_slope,
        "dowhy_backdoor_estimate": float(dowhy_estimate.value),
        "dowhy_ci": [float(ci[0]), float(ci[1])],
        "true_effect": 2.0,
        "references": {
            "statsmodels": __import__("statsmodels").__version__,
            "dowhy": __import__("dowhy").__version__,
        },
    }

    out_path = Path(__file__).parent.parent / "fixtures" / "backdoor-confounding.json"
    out_path.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {out_path}")
    print(json.dumps(fixture, indent=2))


if __name__ == "__main__":
    main()
