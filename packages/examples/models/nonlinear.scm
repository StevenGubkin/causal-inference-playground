# Nonlinear dose-response (README.md's opening example: Y = cos(X) + ...).
# The true do(X) curve is a cosine, offset by the confounder C. A degree-1
# fit (naive or g-comp) can't represent that shape at all; raise the basis
# degree (try ~6) to watch g-computation adjusting for {C} recover the curve.
C ~ Normal(0, 1)
X = C + eps
Y = cos(X) + 2*C + eps
