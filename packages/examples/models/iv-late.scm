# IV/LATE compliance-heterogeneity construction (METHODS.md, "Worked
# construction: compliance heterogeneity"). D_0/D_1 are potential treatment
# values; D_1 = max(D_0, D_extra) enforces monotonicity (no defiers) by
# construction, and Z affects Y only through D (exclusion by construction).
# oracle.doContrast(D: 0->1) averages tau over the whole population (ATE);
# 2SLS of Y on D instrumented by Z recovers E[tau | complier] (LATE), which
# differs because tauAT != tauC below.
latent U       ~ Normal(0, 1)
latent D_0     ~ Bernoulli(logistic(-0.5 + 0.8*U))
latent D_extra ~ Bernoulli(logistic(0.5 + 0.5*U))
latent D_1     = max(D_0, D_extra)
Z              ~ Bernoulli(0.5)
D              = D_0 + (D_1 - D_0)*Z
Y              = (1*D_0*D_1 + 3*(1 - D_0)*D_1)*D + 1.5*U + eps
