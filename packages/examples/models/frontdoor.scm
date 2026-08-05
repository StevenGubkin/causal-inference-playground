# Front-door adjustment example (README.md gallery list, METHODS.md §4).
# U confounds X and Y but is latent, so no valid backdoor set exists --
# findBackdoorSet(X, Y) returns null, and naive OLS is badly biased. M fully
# mediates X's effect on Y with a clean X->M edge and the only M-Y backdoor
# path (M<-X<-U->Y) blocked by conditioning on X, so front-door adjustment
# via M recovers the true effect: 2*3 = 6.0.
latent U ~ Normal(0, 1)
X = 2*U + eps
M = 2*X + eps
Y = 3*M + 5*U + eps
