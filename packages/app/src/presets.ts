import confoundingSrc from '../../examples/models/confounding.scm?raw';
import colliderSrc from '../../examples/models/collider.scm?raw';
import ivLateSrc from '../../examples/models/iv-late.scm?raw';
import mediatorSrc from '../../examples/models/mediator.scm?raw';
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
    caption: 'A naive fit is biased (~3.38); the true effect of X on Y is exactly 2.0.',
  },
  {
    id: 'collider',
    label: 'Collider / M-bias',
    source: colliderSrc,
    treatment: 'X',
    outcome: 'S',
    caption: 'X and Y each cause the collider S with coefficient 1 — no adjustment-set UI yet, so this shows the X→S edge on its own.',
  },
  {
    id: 'mediator',
    label: 'Over-control (mediator)',
    source: mediatorSrc,
    treatment: 'X',
    outcome: 'Y',
    caption: "X's total effect on Y (via M) is 2 — naive already matches truth here, since over-control only appears once you adjust for M.",
  },
  {
    id: 'simpson',
    label: "Simpson's paradox",
    source: simpsonSrc,
    treatment: 'X',
    outcome: 'Y',
    caption: 'Within each stratum of Z the effect is negative, but the confound is strong enough that the naive pooled fit reverses sign.',
  },
  {
    id: 'iv-late',
    label: 'IV / LATE',
    source: ivLateSrc,
    treatment: 'D',
    outcome: 'Y',
    caption: 'D and Y share an unobserved confounder U, so naive OLS is biased — 2SLS/LATE recovery is not wired up yet, just the bias is visible here.',
  },
];
