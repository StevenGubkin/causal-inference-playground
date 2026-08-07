"""ARCHITECTURE.md §10b -- IHDP semi-synthetic benchmark cross-check.

Replaces the deferred "Hernán & Robins worked examples" validation gap.
NHEFS has no do-calculus ground truth to check against -- only one
published point estimate -- and using it would bypass the SCM/oracle
framework entirely. IHDP (Hill 2011; the semi-synthetic benchmark DoWhy's
and EconML's own example notebooks lean on) solves that: real covariates
from an actual RCT (infant care), but a *simulated* outcome model layered
on top, so it ships genuine per-unit ground truth (`mu0`/`mu1`, the
noise-free simulated potential-outcome means) rather than just one paper's
number. `true_ate = mean(mu1 - mu0)` is exact for this realization of the
simulation, no oracle needed.

Unlike every other fixture here, there's no independent DGP to reimplement
in numpy -- IHDP's covariates are real, fixed data, not something either
side re-samples. The "independent implementation" principle still applies,
just shifted: the independence is in the *estimator* implementation (ours
vs. statsmodels/DoWhy/EconML), both run against the identical real rows.

Licensing note (see the IHDP validation plan): the CSV's hosting repos
carry no explicit license, despite a decade of pervasive academic reuse --
a step down from this repo's otherwise clean MIT/no-copyleft posture. So
the dataset itself is deliberately NOT committed anywhere in this repo.
This script downloads it fresh at generation time (same as DoWhy's own
IHDP example notebook already does) and writes only derived summary
numbers to the committed fixture. packages/validation/src/index.ts's
validateIhdp() downloads the same CSV again at `npm run validate` time --
the one network-dependent check in an otherwise fully offline suite
(acceptable: `npm run validate` isn't wired into any CI workflow today,
confirmed by reading .github/workflows/ directly -- it's already a manual,
local developer action).

Run via `uv run python scripts/generate_ihdp_fixture.py` from
packages/validation/. Writes fixtures/ihdp.json.
"""

import json
import urllib.request
from io import StringIO
from pathlib import Path

import pandas as pd
import statsmodels.api as sm
from dowhy import CausalModel
from econml.dr import LinearDRLearner
from sklearn.linear_model import LinearRegression, LogisticRegression

SOURCE_URL = "https://raw.githubusercontent.com/AMLab-Amsterdam/CEVAE/master/datasets/IHDP/csv/ihdp_npci_1.csv"
SEED = 20260808
COVARIATES = [f"x{i}" for i in range(1, 26)]


def main() -> None:
    raw = urllib.request.urlopen(SOURCE_URL, timeout=30).read().decode("utf-8")
    df = pd.read_csv(StringIO(raw), header=None)
    df.columns = ["treatment", "y_factual", "y_cfactual", "mu0", "mu1"] + COVARIATES

    true_ate = float((df["mu1"] - df["mu0"]).mean())
    n_treated = int(df["treatment"].sum())
    n_control = int((df["treatment"] == 0).sum())

    # statsmodels: Y ~ treatment + x1..x25 -- the reference for
    # gcompDoseResponse's linear (degree-1) adjustment over the full
    # covariate set.
    design = sm.add_constant(df[["treatment"] + COVARIATES])
    fit = sm.OLS(df["y_factual"], design).fit()
    statsmodels_estimate = float(fit.params["treatment"])

    # DoWhy: propensity-score weighting -- the reference for ipwAte.
    model = CausalModel(
        data=df[["treatment", "y_factual"] + COVARIATES],
        treatment="treatment",
        outcome="y_factual",
        common_causes=COVARIATES,
    )
    identified = model.identify_effect()
    dowhy_estimate = model.estimate_effect(identified, method_name="backdoor.propensity_score_weighting")

    # EconML: LinearDRLearner (doubly robust) -- the reference for aipwAte,
    # same pattern as generate_ipw_fixture.py.
    dr = LinearDRLearner(model_propensity=LogisticRegression(max_iter=1000), model_regression=LinearRegression(), random_state=SEED)
    dr.fit(df["y_factual"].values, df["treatment"].values, W=df[COVARIATES].values)
    econml_estimate = float(dr.ate())

    fixture = {
        "problem": "IHDP semi-synthetic benchmark (Hill 2011)",
        "source_url": SOURCE_URL,
        "n": len(df),
        "n_treated": n_treated,
        "n_control": n_control,
        "true_ate": true_ate,
        "statsmodels_adjusted_estimate": statsmodels_estimate,
        "dowhy_ipw_estimate": float(dowhy_estimate.value),
        "econml_aipw_estimate": econml_estimate,
        "references": {
            "statsmodels": __import__("statsmodels").__version__,
            "dowhy": __import__("dowhy").__version__,
            "econml": __import__("econml").__version__,
        },
    }

    out_path = Path(__file__).parent.parent / "fixtures" / "ihdp.json"
    out_path.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {out_path}")
    print(json.dumps(fixture, indent=2))


if __name__ == "__main__":
    main()
