# IV/LATE compliance-heterogeneity construction (METHODS.md, "Worked
# construction: compliance heterogeneity"). D0/D1 are potential treatment
# values; D1 = max(D0, D1extra) enforces monotonicity (no defiers) by
# construction, and Z affects Y only through D (exclusion by construction).
# oracle.doContrast(D: 0->1) averages tau over the whole population (ATE);
# 2SLS of Y on D instrumented by Z recovers E[tau | complier] (LATE), which
# differs because tauAT != tauC below.
latent U        ~ Normal(0, 1)
latent D0       ~ Bernoulli(logistic(-0.5 + 0.8*U))
latent D1extra  ~ Bernoulli(logistic(0.5 + 0.5*U))
latent D1       = max(D0, D1extra)
Z               ~ Bernoulli(0.5)
D               = D0 + (D1 - D0)*Z
Y               = (1*D0*D1 + 3*(1 - D0)*D1)*D + 1.5*U + eps
