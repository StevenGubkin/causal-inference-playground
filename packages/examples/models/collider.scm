# Collider / M-bias example (README.md gallery list).
# X and Y are independent, but both cause the collider S. There is no
# causal effect of X on Y; conditioning on S (e.g. adjusting for it, or
# selecting on it) opens a spurious X-S-Y path and creates one.
X ~ Normal(0, 1)
Y ~ Normal(0, 1)
S = X + Y + eps
