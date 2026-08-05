import confoundingSrc from '../../examples/models/confounding.scm?raw';
import colliderSrc from '../../examples/models/collider.scm?raw';
import frontdoorSrc from '../../examples/models/frontdoor.scm?raw';
import ivLateSrc from '../../examples/models/iv-late.scm?raw';
import mediatorSrc from '../../examples/models/mediator.scm?raw';
import nonlinearSrc from '../../examples/models/nonlinear.scm?raw';
import simpsonSrc from '../../examples/models/simpson.scm?raw';

export interface Preset {
  id: string;
  label: string;
  source: string;
  treatment: string;
  outcome: string;
  caption: string;
}

export const PRESETS: Preset[] = [
  {
    id: 'confounding',
    label: 'Confounding',
    source: confoundingSrc,
    treatment: 'X',
    outcome: 'Y',
    caption: 'A naive fit is biased (~3.38); the true effect of X on Y is exactly 2.0. Adjust for C to watch g-computation recover it.',
  },
  {
    id: 'collider',
    label: 'Collider / M-bias',
    source: colliderSrc,
    treatment: 'X',
    outcome: 'Y',
    caption: 'X and Y are independent (true effect 0) — naive already gets that right. Adjust for the collider S and watch g-computation invent a spurious effect.',
  },
  {
    id: 'mediator',
    label: 'Over-control (mediator)',
    source: mediatorSrc,
    treatment: 'X',
    outcome: 'Y',
    caption: "X's total effect on Y (via M) is 2 — naive already matches truth. Adjust for the mediator M and watch g-computation erase the effect.",
  },
  {
    id: 'simpson',
    label: "Simpson's paradox",
    source: simpsonSrc,
    treatment: 'X',
    outcome: 'Y',
    caption: 'Within each stratum of Z the effect is negative, but the confound reverses the naive pooled fit. Adjust for Z to recover the true (negative) direction.',
  },
  {
    id: 'iv-late',
    label: 'IV / LATE',
    source: ivLateSrc,
    treatment: 'D',
    outcome: 'Y',
    caption:
      "D and Y share an unobserved confounder U, so naive OLS is biased. The compliers' effect is exactly 3 here, vs. always-takers' effect of 1 — set Z as the instrument to recover that complier-only LATE via 2SLS, and watch \"true LATE\" below diverge from the population \"true effect\" the oracle computes.",
  },
  {
    id: 'nonlinear',
    label: 'Nonlinear dose-response (cos)',
    source: nonlinearSrc,
    treatment: 'X',
    outcome: 'Y',
    caption: 'The true curve is a cosine — a degree-1 fit can\'t represent that shape at all. Raise the basis degree (~6) and adjust for C to watch g-computation recover it.',
  },
  {
    id: 'frontdoor',
    label: 'Front-door adjustment',
    source: frontdoorSrc,
    treatment: 'X',
    outcome: 'Y',
    caption: 'U confounds X and Y but is unobserved — no valid backdoor set exists, so naive is badly biased. Set M as the mediator (front-door) to recover the true effect of 6.0 anyway.',
  },
];
