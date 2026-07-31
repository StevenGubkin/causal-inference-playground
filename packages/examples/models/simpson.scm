# Simpson's paradox example (README.md gallery list).
# Within each stratum of Z, X has a negative effect on Y (coefficient -1).
# But Z also drives X and Y directly, strongly enough that the marginal
# (pooled-over-Z) association between X and Y reverses sign. Adjusting for
# Z recovers the within-stratum (true) direction.
Z ~ Bernoulli(0.5)
X = Z + eps
Y = -X + 2*Z + eps
