# IPW/AIPW golden-test fixture (METHODS.md §4's IPW/AIPW sections). Binary
# treatment X confounded by a continuous Z -- the shape IPW/AIPW are built
# for (gcomp handles continuous Z with a continuous X; stratify handles
# discrete Z; this is the "propensity score" case: binary X, any Z).
# True effect of X on Y: 2.0 -- do(X=x) fixes X exogenously, so Z's 3*Z
# term has the same (zero-centered) distribution on both arms and
# contributes equally to E[Y|do(X=0)] and E[Y|do(X=1)]; the contrast is
# exactly the coefficient on X. Naive OLS is biased upward because higher Z
# raises both P(X=1) (via the propensity model) and Y directly (via the 3*Z
# term), inducing positive correlation between X and the very confounder
# that also drives Y.
Z ~ Normal(0, 1)
X ~ Bernoulli(logistic(0.5*Z))
Y = 2*X + 3*Z + eps
