"""ARCHITECTURE.md §10b -- g-computation dose-response (flexible basis) cross-check.

Replicates nonlinear.scm's DGP directly in numpy (C~N(0,1); X=C+eps;
Y=cos(X)+2*C+eps, eps~N(0,1) per node) and fits the same polynomial-basis
g-formula our own gcompDoseResponse (packages/estimators/src/gcomp.ts) does --
[X, X^2, ..., X^degree] raw powers (no standardization, confirmed by reading
that file directly) plus a linear adjustment for C, predicted at each grid
point averaged over the empirical distribution of C -- against statsmodels
as an independent reference implementation.

Since C's marginal distribution (~N(0,1)) is unaffected by intervening on X
(X's own equation is cut, C's isn't), and 2*C's contribution integrates to a
constant offset independent of the intervention value, the true curve has an
exact closed form: E[Y | do(X=x)] = cos(x). No simulation needed for ground
truth -- this fixture checks both the cross-library agreement (gcomp curve
vs. statsmodels curve) and the closed-form truth (vs. cos(grid)) in one pass.

Run via `uv run python scripts/generate_gcomp_nonlinear_fixture.py` from
packages/validation/. Writes fixtures/gcomp-nonlinear.json.
"""

import json
from pathlib import Path

import numpy as np
import statsmodels.api as sm

SEED = 20260802
N = 20000
DEGREE = 6  # matches nonlinear.scm's own comment: "raise the basis degree (try ~6)"


def main() -> None:
    rng = np.random.default_rng(SEED)
    c = rng.normal(0, 1, N)
    x = c + rng.normal(0, 1, N)
    y = np.cos(x) + 2 * c + rng.normal(0, 1, N)

    # Design matrix [X, X^2, ..., X^degree, C] -- raw powers, matching
    # gcomp.ts's polynomialBasis exactly (no standardization).
    design = np.column_stack([x**d for d in range(1, DEGREE + 1)] + [c])
    fit = sm.OLS(y, sm.add_constant(design)).fit()

    grid = np.linspace(-3, 3, 13)

    # G-formula: at each grid point x0, predict at (x0, x0^2, ..., x0^degree, C_i)
    # for every observed row i, average over the empirical distribution of C --
    # the same procedure gcompDoseResponse itself uses.
    gcomp_curve = []
    for x0 in grid:
        powers = [x0**d for d in range(1, DEGREE + 1)]
        preds = fit.params[0] + sum(fit.params[i + 1] * powers[i] for i in range(DEGREE)) + fit.params[DEGREE + 1] * c
        gcomp_curve.append(float(preds.mean()))

    true_curve = np.cos(grid)

    fixture = {
        "problem": "g-computation dose-response, flexible (polynomial) basis (nonlinear.scm)",
        "dgp": "C ~ Normal(0,1); X = C + eps; Y = cos(X) + 2*C + eps",
        "n": N,
        "seed": SEED,
        "degree": DEGREE,
        "grid": grid.tolist(),
        "gcomp_curve": gcomp_curve,
        "true_curve": true_curve.tolist(),
        "references": {"statsmodels": __import__("statsmodels").__version__},
    }

    out_path = Path(__file__).parent.parent / "fixtures" / "gcomp-nonlinear.json"
    out_path.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {out_path}")
    print(json.dumps(fixture, indent=2))


if __name__ == "__main__":
    main()
