# Remains to be implemented

A single running list of what's *not* built yet (or built but broken/weak), kept next
to the code instead of scattered across README/ARCHITECTURE/METHODS notes. This file
is reviewed and updated as part of every push — see `CLAUDE.md`.

Last reviewed: 2026-08-08 (two independent critical-review agents evaluated the whole
repo — one on correctness/rigor, one on product/UX/architecture. Fixed the two most
severe findings directly: AIPW's plotted-curve sign bug, and IPW/AIPW's missing
identifiability warning. Everything else they surfaced is catalogued below.)

## Known bugs

- **6 of 10 documented distributions have no sampler.** `Binomial`, `Categorical`,
  `Exponential`, `Gamma`, `Beta`, `LogNormal` all pass DSL parse-time validation
  (`packages/scm-dsl/src/distributions.ts`) but `packages/scm-engine/src/samplers.ts`'s
  `SAMPLERS` table only implements `Normal`/`Bernoulli`/`Uniform`/`Poisson` — the other
  six throw at `forwardSample` time. There is **no React error boundary anywhere in
  `packages/app/src`**, so typing e.g. `X ~ Beta(2, 2)` — literally suggested by the
  Freeform starter template's own help text — **crashes the whole app to a blank white
  screen** with no user-facing message. This is the single highest-priority item on
  this list: it's reachable by any first-time visitor doing something completely
  ordinary. Fix options: implement the 6 missing samplers (standard inverse-CDF/
  rejection sampling, nothing exotic), and/or add a top-level error boundary so any
  future gap like this degrades to a message instead of a crash, and/or reject
  unimplemented distributions at parse time instead of only documenting them as v1.
- **Permalink "copy" has no error handling.** `PlaygroundView.tsx`'s `copyPermalink()`
  calls `navigator.clipboard.writeText(url).then(...)` with no `.catch()`. Reproduced
  live: with clipboard permission denied, the click does nothing — no "Copied!" flash,
  no error message, no fallback (e.g. a selectable text field with the URL). Relevant
  beyond the obvious UX gap: `navigator.clipboard.writeText` commonly rejects or is
  unavailable in third-party-iframe contexts without an explicit `clipboard-write`
  Permissions-Policy — directly relevant to the embeddable-widget item below, which
  would put this exact button inside an iframe.
- **(Minor/cosmetic)** The ATE-mode `<label>` wraps a radio *and* two live number
  inputs together (`<label><input type="radio"/>effect from<input type="number"/>to
  <input type="number"/></label>`), so clicking near either number input can toggle
  the estimand radio as a side effect of label semantics — an accessibility/semantics
  smell (interactive controls shouldn't nest inside another control's implicit
  activation target), not confirmed to cause a real click misfire in practice.

## Near-term (tracked in ARCHITECTURE.md, expected to ship)

- **Embeddable `<iframe>`/web-component widget** — not started.
- **The `Estimator` interface from ARCHITECTURE.md §8** (`id`/`label`/`reference`,
  `requirements()`/`applicable()`, a registry-style identifiability gate) was never
  built — `packages/estimators/src/index.ts` still has a stale comment claiming it
  exists. Gating instead lives hand-inlined in `PlaygroundView.tsx`, called ad hoc per
  estimator. This is the root cause that let IPW/AIPW ship with no identifiability
  warning at all (patched directly — see "Fixed" below — but the underlying "no
  registry" gap remains, and the next new estimator could reintroduce the same class
  of bug). Building the real registry would also let `PlaygroundView.tsx` stop
  hand-wiring `backdoorValid`/`instrumentValid`/`frontdoorValid` calls individually.
- **`ATT` and `CATE`** — ARCHITECTURE.md §1/§8 name both as v1-scope estimands (the
  `Estimand` type includes `{ kind: "ATT" }` and `{ kind: "CATE" }`), but grepping the
  entire implementation for either returns zero matches outside comments/types. No
  estimator computes an average-effect-on-the-treated or a covariate-conditional
  effect anywhere. (README doesn't claim these either, so this is a spec-vs-code gap,
  not a false end-user-facing claim.)
- **M-bias has no reachable example in the shipped app.** The "Collider / M-bias"
  preset (`packages/app/src/presets.ts`) is actually just a plain post-treatment
  collider (`collider.scm`) — a different, simpler paradox than true M-bias (a
  collider between two *unobserved* confounders that looks like an innocuous
  pre-treatment covariate, arguably the single best "aha" result in the whole
  causal-inference paradox canon). The only M-bias fixture in the repo is inline in
  `packages/graph/src/backdoor.test.ts`, explicitly commented "not a committed
  preset." Needs a real `.scm` file in `packages/examples/models/` and a correctly
  labeled preset distinct from the current collider one.
- **IV with broken exclusion, and IV with broken monotonicity** — both explicitly
  named in ARCHITECTURE.md §13 ("ship these on day one") and METHODS.md ("worth
  shipping as gallery entries... variants of the existing `iv-late.scm` skeleton" —
  add a direct `Z → Y` edge for broken exclusion, or replace `D_1 = max(D_0,
  D_extra)` with an independent `D_1 ~ Bernoulli(...)` for broken monotonicity/
  defiers). The hard construction work is already done; neither variant exists as a
  `.scm` file or preset. Broken exclusion has at least a graph-validity test
  confirming `instrumentValid` catches it; broken monotonicity has no test or fixture
  anywhere.
- **No error boundary anywhere in `packages/app`.** Beyond the distribution-sampler
  crash above, every estimator call in the `run` `useMemo` (`gcompDoseResponse`,
  `kernelRidgeDoseResponse`, `iv2sls`, `frontdoorDoseResponse`, `ipwAte`, `aipwAte`)
  runs unguarded except `stratifyResult` (the one place with a try/catch, specifically
  called out in a comment as the exception). A single thrown error from a pathological
  Freeform model (e.g. a singular OLS design matrix) blanks the whole results section
  with a raw React error instead of a contained message.

## Technical debt / weaknesses

Not "missing" features exactly, but real quality/architecture issues surfaced by
review, worth fixing opportunistically rather than letting compound:

- **`PlaygroundView.tsx` is a 1,200+ line component with no test file at all** — by
  far the largest file in the repo (next largest is under 150 lines). ~27 `useState`
  hooks, no `useReducer`/context/sub-hooks. Three near-identical hand-rolled
  `setTimeout`-batched chunking loops exist in this one file (Monte Carlo's `step()`,
  bootstrap CI's `bootstrapStep()`/`jackknifeStep()`) that should be one shared
  `runChunked(total, batchSize, workFn, onProgress)` hook — each reimplements the same
  generation-ref-guard-against-stale-writes pattern by hand. Monte Carlo mode and the
  Confidence Intervals panel, added in separate sessions, read as two bolted-together
  features (separate replicate-count inputs, separate progress counters, different
  button verbs) rather than one coherent "uncertainty" story.
- **Security sandbox is single-layer, not the documented defense-in-depth.**
  ARCHITECTURE.md §4.8/§14 call for a *restricted* `math.create()` instance (no
  `import`, no matrix/unit constructors) **plus** the identifier/function allow-list,
  as two independent layers. `packages/scm-dsl/src/math-instance.ts` actually
  constructs the full, unrestricted mathjs instance and relies entirely on the
  AST-node-type allow-list as the only defense — a reasonable design on its own
  merits, but not what's documented, and it means one missed node type or a mathjs
  version bump has no second line of defense. Only 2 hand-picked security tests exist
  (property access, `import()`); no systematic/fuzz test of the allow-list against
  mathjs's broader surface (`derivative()`, `parser()`, `chain()`, etc.).
- **Zero design system.** No `.css` file anywhere under `packages/app/src` — every
  color/spacing/border-radius is a hand-typed inline `style={{...}}` value, repeated
  dozens of times with no shared tokens. No dark mode (`prefers-color-scheme` isn't
  handled at all — the app is unreadable against a dark OS theme). For a project whose
  audience is explicitly evaluating engineering quality as a portfolio signal, this
  reads as unfinished.
- **Color is the only channel for status** (valid/invalid gates, overlap quality,
  Monte Carlo coverage near/far from nominal) — no icon/shape/texture differentiation,
  a real accessibility gap for red-green color vision deficiency.
- **No in-app link to any of the credibility evidence.** Zero rendered UI links to
  METHODS.md, ARCHITECTURE.md, the validation table, or even a GitHub URL — only
  exists in README.md on GitHub. Since permalinks (bypassing the README entirely) are
  the stated primary distribution mechanism, most people who actually see a shared
  link never learn there's validation evidence or a repo behind it.
- **Jargon used in the UI with no in-app definitions** — "backdoor adjustment set,"
  "LATE (compliers)," "AIPW," "BCa," "jackknife," "overlap" etc. appear as bare labels
  with no tooltip/glossary, despite METHODS.md having precise plain-language
  explanations of every one that never surface in-app.
- **DAG canvas doesn't adapt to narrow/mobile viewports** — renders cramped at 390px
  width, requires manual pinch-zoom; doesn't auto-fit the way it does at desktop width.
- **No onboarding, and no discoverability hint for Monte Carlo mode / the CI panel.**
  The Freeform default view shows a trivial, non-confounded model with no nudge toward
  the Examples gallery where the actual payoff lives. Monte Carlo mode and the
  Confidence Intervals panel both only render after switching the estimand radio to
  "effect from/to" — nothing on the default dose-response view hints they exist.
- **No favicon/OG metadata** — a shared permalink (the stated growth loop) renders as
  a bare URL with no social preview card on Twitter/Slack/Discord.
- **No "reset to default" affordance** in Freeform or a modified example (re-visiting
  an example's URL does correctly reset it, but there's no in-page button).
- **Test coverage gaps**, several independent of the AIPW bug already fixed:
  - No dedicated test for ARCHITECTURE.md §10a golden test #2 ("two `eps`-using nodes
    have sample noise correlation ≈ 0") — almost certainly true, but not regression-tested.
  - METHODS.md §5's flagship claim (naive's CI is tight and excludes the truth under
    all three methods on the confounding example) has no direct unit test — verified
    true manually during review, but resting on manual verification, not a regression test.
  - `kernelRidge.ts` has no numerical-stability test at small bandwidth (near-singular
    Gram matrix) and no documented/guarded sample-size limit despite worse-than-every-
    other-estimator cost scaling (O(n²) memory, O(n³) Cholesky).
  - `fitMultivariateOLS`/`fitLogisticRegression` have no collinearity/near-singular
    test beyond one documented case in `frontdoor.test.ts`; `gcompDoseResponse` at
    high polynomial degree (validation suite only exercises degree=6) is untested at
    degree 10+, where the raw power basis becomes severely ill-conditioned.
  - No test that IPW/AIPW's overlap diagnostics (`minOverlap`, effective sample size)
    actually flag a genuinely bad-overlap scenario as bad.
- **Dead code**: `packages/estimators/src/ols.ts`'s `fitSimpleLinearRegression`/
  `predictOverGrid` are exported and tested but never imported by `packages/app` (the
  naive/gcomp path uses `gcompDoseResponse` with an empty adjustment set instead).
- **`Distribution.sample` in the compiled Model IR is permanently dead.**
  `compileDistribution` always sets `sample: notImplementedSample`, because actual
  sampling dispatch happens through a completely separate lookup table in
  `scm-engine/src/samplers.ts` that never calls it. Not a functional bug today (nothing
  calls the field), but the documented IR interface has a permanently-broken method on
  every node — a latent trap for future code that (correctly, per the interface) tries
  to call it directly.

## Smaller gaps

- **Analytic (closed-form) confidence intervals** — METHODS.md calls for "the
  nonparametric bootstrap by default, analytic forms where they are exact." Only
  bootstrap (percentile/basic/BCa) is implemented. Worth being more pointed than
  "smaller gap" framing suggests: for `naive`/`gcomp` (OLS-based), an analytic CI is a
  couple of lines (`Var(β̂) = σ²(XᵀX)⁻¹`) and would let the tool demonstrate a second
  classic point — that naive's confidently-wrong interval isn't a bootstrap artifact,
  it's the same story with the closed-form Wald interval. Currently there's no way to
  show the two agree (or diverge, e.g. under heteroskedasticity).
- **The live-slider signature interaction** — ARCHITECTURE.md §11 describes a
  gallery-model slider (confounding strength, selection rate, effect heterogeneity)
  where the estimate visibly flips sign or a CI stops covering the truth *while
  dragging*, with a two-tier update (cheap immediate recompute, then a debounced full
  recompute with bootstrap CIs). None of this exists — the app uses plain number
  inputs/checkboxes with a single debounced recompute, which real benchmarking has
  shown is fast enough without a live-drag fast path. The underlying demonstrations
  are all reachable via the existing controls; only the "drag and watch it happen
  live" interaction itself was never built.
- **No property-based/fuzz test of the mathjs sandbox allow-list** — given
  ARCHITECTURE.md frames it as "a security boundary, not just a UX nicety," the 2
  existing hand-picked tests are thin for that claim. Worth a systematic test
  iterating mathjs's exposed function names and asserting each non-allow-listed one
  is rejected.

## Explicitly out of v1 scope (ARCHITECTURE.md §16 — design for, don't build)

Not being worked toward; listed so it's clear these are deliberate non-goals, not
oversights:

- The general Shpitser–Pearl `ID` algorithm (validate vs. Ananke)
- Double/debiased ML, TMLE, causal forests, S/T/X-learners
- Causal discovery mode (hide the graph, run PC/GES/LiNGAM/NOTEARS, compare to truth)
- Time index for g-methods / MSMs / DiD / panel data
- A selection-bias `restrict` clause
- Measurement error
- Sensitivity analysis (E-values / Rosenbaum bounds / omitted-variable bias)
- Stochastic/conditional interventions
- Quantile treatment effects
