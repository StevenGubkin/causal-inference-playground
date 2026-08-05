"""ARCHITECTURE.md §10b -- IV/2SLS (LATE) cross-check.

Replicates iv-late.scm's DGP directly in numpy (METHODS.md's "Worked
construction: compliance heterogeneity" -- potential-outcome parents D0/D1,
monotonicity via max(), Z affecting Y only through D) and runs linearmodels'
IV2SLS as an independent reference implementation of our own iv2sls.ts.

The first-stage F is computed via statsmodels directly (the classical F for
D ~ 1 + Z), not linearmodels' own first_stage diagnostic -- that one is
heteroskedasticity-robust and chi2-distributed by default, not the same
statistic as the classical F our TypeScript implementation computes, so
comparing against it directly would be apples-to-oranges.

Run via `uv run python scripts/generate_iv_fixture.py` from
packages/validation/. Writes fixtures/iv-late.json.
"""

import json
from pathlib import Path

import numpy as np
import pandas as pd
import statsmodels.api as sm
from linearmodels.iv import IV2SLS

SEED = 20260802
N = 20000


def logistic(x: np.ndarray) -> np.ndarray:
    return 1 / (1 + np.exp(-x))


def main() -> None:
    rng = np.random.default_rng(SEED)
    u = rng.normal(0, 1, N)
    d0 = (rng.random(N) < logistic(-0.5 + 0.8 * u)).astype(float)
    d1extra = (rng.random(N) < logistic(0.5 + 0.5 * u)).astype(float)
    d1 = np.maximum(d0, d1extra)
    z = (rng.random(N) < 0.5).astype(float)
    d = d0 + (d1 - d0) * z
    tau = 1 * d0 * d1 + 3 * (1 - d0) * d1
    y = tau * d + 1.5 * u + rng.normal(0, 1, N)

    df = pd.DataFrame({"Y": y, "D": d, "Z": z})
    iv_fit = IV2SLS.from_formula("Y ~ 1 + [D ~ Z]", data=df).fit()
    estimate = float(iv_fit.params["D"])

    # Classical first-stage F: D ~ 1 + Z.
    first_stage = sm.OLS(d, sm.add_constant(z)).fit()
    first_stage_f = float(first_stage.fvalue)

    # Population ATE for context (not what 2SLS should match -- the whole
    # point of this construction is that it doesn't). Computed the same way
    # our oracle does: fix D for everyone and average tau over the
    # population, since D0/D1 (and therefore tau) are unaffected by which
    # value D is set to.
    true_ate = float(np.mean(tau))

    fixture = {
        "problem": "IV/2SLS (LATE) (iv-late.scm)",
        "dgp": "potential-outcome parents D0/D1 (METHODS.md worked construction); "
        "D0~Bernoulli(logistic(-0.5+0.8U)); D1=max(D0, D1extra); D=D0+(D1-D0)*Z",
        "n": N,
        "seed": SEED,
        "iv2sls_estimate": estimate,
        "first_stage_f": first_stage_f,
        "population_ate_tauC_3_tauAT_1": true_ate,
        "references": {
            "linearmodels": __import__("linearmodels").__version__,
            "statsmodels": __import__("statsmodels").__version__,
        },
    }

    out_path = Path(__file__).parent.parent / "fixtures" / "iv-late.json"
    out_path.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {out_path}")
    print(json.dumps(fixture, indent=2))


if __name__ == "__main__":
    main()
