"""ARCHITECTURE.md §10b -- IPW/AIPW ATE cross-check.

Replicates ipw-confounding.scm's DGP directly in numpy (Z~N(0,1);
X~Bernoulli(logistic(0.5*Z)); Y=2*X+3*Z+eps, eps~N(0,1)) and computes the
same two numbers our own TypeScript pipeline computes -- Horvitz-Thompson/
Hajek-normalized IPW (packages/estimators/src/ipw.ts) and doubly-robust AIPW
(packages/estimators/src/aipw.ts) -- against DoWhy's propensity-score
weighting and EconML's doubly-robust learner as independent reference
implementations, per the same "oracle must be an independent source of
truth" argument the backdoor/IV/front-door fixtures already use.

Exact numerical agreement isn't expected here: DoWhy's propensity-score
weighting and EconML's doubly-robust learner use different formulas
(EconML's DRLearner cross-fits with sample-splitting) than our own
Hajek-normalized IPW / augmented-IPW -- same generous tolerance every other
cross-library check already uses (this is about the population quantity
both sides converge to, not bitwise agreement).

Run via `uv run python scripts/generate_ipw_fixture.py` from
packages/validation/. Writes fixtures/ipw-aipw-confounding.json.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
from dowhy import CausalModel
from econml.dr import LinearDRLearner
from sklearn.linear_model import LinearRegression, LogisticRegression

SEED = 20260803
N = 20000


def sigmoid(v: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-v))


def main() -> None:
    rng = np.random.default_rng(SEED)
    z = rng.normal(0, 1, N)
    p = sigmoid(0.5 * z)
    x = (rng.uniform(0, 1, N) < p).astype(float)
    y = 2 * x + 3 * z + rng.normal(0, 1, N)

    # DoWhy: identify + estimate via propensity-score weighting -- an
    # independent cross-check of ipwAte.
    model = CausalModel(
        data=pd.DataFrame({"X": x, "Y": y, "Z": z}),
        treatment="X",
        outcome="Y",
        common_causes=["Z"],
    )
    identified = model.identify_effect()
    dowhy_estimate = model.estimate_effect(
        identified,
        method_name="backdoor.propensity_score_weighting",
        confidence_intervals=True,
    )
    dowhy_ci = dowhy_estimate.get_confidence_intervals()

    # EconML: LinearDRLearner is a doubly-robust (augmented-IPW-style)
    # estimator -- an independent cross-check of aipwAte. W (not X) since Z
    # is purely a confounder here, not an effect-modifying feature -- we
    # want the population ATE, not a CATE.
    dr = LinearDRLearner(model_propensity=LogisticRegression(), model_regression=LinearRegression(), random_state=SEED)
    dr.fit(y, x, W=z.reshape(-1, 1))
    econml_estimate = float(dr.ate())

    fixture = {
        "problem": "IPW / AIPW ATE (ipw-confounding.scm)",
        "dgp": "Z ~ Normal(0,1); X ~ Bernoulli(logistic(0.5*Z)); Y = 2*X + 3*Z + eps",
        "n": N,
        "seed": SEED,
        "true_effect": 2.0,
        "dowhy_ipw_estimate": float(dowhy_estimate.value),
        "dowhy_ci": [float(dowhy_ci[0]), float(dowhy_ci[1])],
        "econml_aipw_estimate": econml_estimate,
        "references": {
            "dowhy": __import__("dowhy").__version__,
            "econml": __import__("econml").__version__,
        },
    }

    out_path = Path(__file__).parent.parent / "fixtures" / "ipw-aipw-confounding.json"
    out_path.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {out_path}")
    print(json.dumps(fixture, indent=2))


if __name__ == "__main__":
    main()
