import { PlaygroundView } from '../PlaygroundView';

const STARTER_SOURCE = `# Write your own structural causal model.
# NAME = expr        deterministic node (math: + - * / ^, exp, log, sqrt, sin, cos, min, max, logistic, clamp, step)
# NAME ~ Dist(args)  stochastic node -- Normal, Bernoulli, Uniform, Poisson, Binomial, Categorical, Exponential, Gamma, Beta, LogNormal
# eps                independent per-equation noise
# latent NAME ...    hide this node from the observed sample
# X <-> Y            unobserved confounder shared between X and Y

X ~ Normal(0, 1)
Y = 2*X + eps
`;

export function FreeformPage() {
  return <PlaygroundView initialSource={STARTER_SOURCE} initialTreatment="X" initialOutcome="Y" />;
}
