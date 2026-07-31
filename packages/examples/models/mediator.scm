# Over-control example (README.md gallery list).
# X's total effect on Y is 2, entirely routed through the mediator M.
# Adjusting for M blocks that path and erases the effect being measured.
X ~ Normal(0, 1)
M = X + eps
Y = 2*M + eps
