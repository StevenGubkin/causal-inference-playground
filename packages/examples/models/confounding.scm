# Canonical confounding example (README.md, METHODS.md §1).
# True effect of X on Y: 2.0. Naive (unadjusted) slope ~3.38; g-computation
# adjusting for {C} recovers ~2.00, matching the interventional oracle.
C ~ Normal(0, 1)
X = 1.5*C + eps
Y = 2*X + 3*C + eps
