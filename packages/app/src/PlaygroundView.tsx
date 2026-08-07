import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { createRNG, doContrast, doResponse, forwardSample, lateContrast } from 'scm-engine';
import type { Curve } from 'scm-engine';
import { aipwAte, fitMultivariateOLS, frontdoorDoseResponse, gcompDoseResponse, ipwAte, isBinaryColumn, iv2sls, kernelRidgeDoseResponse, stratifyDoseResponse } from 'estimators';
import { backdoorValid, findBackdoorSet, frontdoorValid, instrumentValid } from 'graph';
import { parseModel, parseStatements } from 'scm-dsl';
import { decodePermalink, describePermalinkError, encodePermalink } from 'share';
import type { DecodeResult } from 'share';
import { ComparisonChart } from './ComparisonChart';
import { DagView } from './DagView';
import { statementToLatex } from './equationLatex';
import { downloadFile, modelToPython, modelToSvg, sampleToCsv } from './export/index.js';
import { clampBandwidth, clampCoverageInnerReplicates, clampDegree, clampLambda, clampNoiseSD, clampReplicateCount } from './limits.js';
import { MathField } from './MathField';
import { computeCI, runBootstrapReplicate, runJackknifeReplicate } from './bootstrapCi.js';
import type { BootstrapCIResult, CIMethod } from './bootstrapCi.js';
import { runCoverageReplicate, summarizeCoverage } from './coverageCheck.js';
import type { CoverageCIMethod } from './coverageCheck.js';
import { MonteCarloChart } from './MonteCarloChart.js';
import { computeEstimateSet, runMonteCarloReplicate, summarizeReplicates } from './monteCarlo.js';
import type { EstimatorConfig, MonteCarloConfig, MonteCarloReplicate } from './monteCarlo.js';

const SAMPLE_SIZE = 500;
const ORACLE_REPLICATES = 3000;
const GRID_POINTS = 25;
const SOURCE_DEBOUNCE_MS = 400;

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// CRN (ARCHITECTURE.md §6 INVARIANT) makes the oracle's curve exactly
// linear, down to floating-point noise, whenever the true structural
// relationship actually is linear -- so consecutive second differences near
// zero (relative to the curve's own range) is a reliable, purely numeric
// linearity check, no symbolic analysis of the model needed.
function isApproximatelyLinear(curve: Curve): boolean {
  const { ys } = curve;
  if (ys.length < 3) return true;
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const yRange = yMax - yMin;
  if (yRange < 1e-9) return true; // flat curve: slope 0 either way
  const tolerance = 0.02 * yRange;
  for (let i = 1; i < ys.length - 1; i++) {
    const secondDifference = ys[i - 1]! - 2 * ys[i]! + ys[i + 1]!;
    if (Math.abs(secondDifference) > tolerance) return false;
  }
  return true;
}

function rmseAgainstTruth(estimatedYs: number[], trueYs: number[]): number {
  let sumSq = 0;
  for (let i = 0; i < estimatedYs.length; i++) sumSq += (estimatedYs[i]! - trueYs[i]!) ** 2;
  return Math.sqrt(sumSq / estimatedYs.length);
}

type Estimand = 'doseResponse' | 'ate';
type BasisMode = 'polynomial' | 'kernelRidge';

interface PlaygroundViewProps {
  initialSource: string;
  initialTreatment: string;
  initialOutcome: string;
  caption?: string;
}

export function PlaygroundView({ initialSource, initialTreatment, initialOutcome, caption }: PlaygroundViewProps) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  // Decode exactly once, at mount, from whatever `state` was present in the
  // URL at that moment -- not tracked afterward (no live URL sync, see the
  // "Copy permalink" button below), so no dependency on searchParams here.
  const [decodeResult] = useState<DecodeResult | null>(() => {
    const raw = searchParams.get('state');
    return raw ? decodePermalink(raw) : null;
  });
  const decoded = decodeResult?.ok ? decodeResult.payload : null;

  const [source, setSource] = useState(decoded?.model ?? initialSource);
  const [treatment, setTreatment] = useState(decoded?.query.treatment ?? initialTreatment);
  const [outcome, setOutcome] = useState(decoded?.query.outcome ?? initialOutcome);
  const [adjustmentSet, setAdjustmentSet] = useState<Set<string>>(new Set(decoded?.query.adjustmentSet ?? []));
  const [instrument, setInstrument] = useState(decoded?.query.instrument ?? '');
  const [mediator, setMediator] = useState(decoded?.query.mediator ?? '');
  const [seed, setSeed] = useState(decoded?.seed ?? 1);
  const [estimand, setEstimand] = useState<Estimand>(decoded?.query.estimand ?? 'doseResponse');
  const [ateA, setAteA] = useState(decoded?.query.ateA ?? 0);
  const [ateB, setAteB] = useState(decoded?.query.ateB ?? 1);
  const [degree, setDegree] = useState(clampDegree(decoded?.query.degree ?? 1));
  const [basisMode, setBasisMode] = useState<BasisMode>(decoded?.query.basisMode ?? 'polynomial');
  const [bandwidth, setBandwidth] = useState(clampBandwidth(decoded?.query.bandwidth ?? 1));
  const [lambda, setLambda] = useState(clampLambda(decoded?.query.lambda ?? 0.1));
  const [noiseSD, setNoiseSD] = useState(clampNoiseSD(decoded?.query.noiseSD ?? 1));
  const [permalinkCopied, setPermalinkCopied] = useState(false);
  const [mcReplicateCount, setMcReplicateCount] = useState(200);
  const [mcReplicates, setMcReplicates] = useState<MonteCarloReplicate[]>([]);
  const [mcRunning, setMcRunning] = useState(false);
  const [mcProgress, setMcProgress] = useState(0);
  // Guards a stale in-flight setTimeout-batched run from writing into state
  // after a newer run started, or after the underlying model/treatment/
  // adjustment changed out from under it -- a multi-tick loop, not a single
  // effect cleanup-cancelable call, so this can't rely on useEffect cleanup.
  const mcGeneration = useRef(0);
  const [coverageEnabled, setCoverageEnabled] = useState(false);
  const [coverageMethod, setCoverageMethod] = useState<CoverageCIMethod>('percentile');
  const [coverageInnerReplicates, setCoverageInnerReplicates] = useState(30);
  const [mcCoverageCis, setMcCoverageCis] = useState<Record<string, BootstrapCIResult | null>[]>([]);
  const [ciMethod, setCiMethod] = useState<CIMethod>('percentile');
  const [ciReplicateCount, setCiReplicateCount] = useState(200);
  const [ciResults, setCiResults] = useState<Record<string, BootstrapCIResult> | null>(null);
  const [ciRunning, setCiRunning] = useState(false);
  const [ciProgress, setCiProgress] = useState(0); // combined bootstrap+jackknife progress
  const [ciTotal, setCiTotal] = useState(0);
  const ciGeneration = useRef(0);

  const debouncedSource = useDebouncedValue(source, SOURCE_DEBOUNCE_MS);
  const parsed = useMemo(() => parseModel(debouncedSource), [debouncedSource]);
  // Syntax-level only (parseStatements, not the full parseModel/validate
  // pipeline) so the math preview keeps rendering whatever lines are
  // individually well-formed even while other lines have cross-referential
  // errors (an unknown identifier, say) that only validate() catches.
  const equationStatements = useMemo(() => parseStatements(debouncedSource).statements, [debouncedSource]);

  const observedNodes = useMemo(() => (parsed.ok ? parsed.model.observed() : []), [parsed]);

  // Treatment/outcome track what the user picked, but fall back to
  // something valid in the current model rather than pointing at a node
  // that got edited away.
  const effectiveTreatment = observedNodes.includes(treatment) ? treatment : (observedNodes[0] ?? '');
  const effectiveOutcome =
    observedNodes.includes(outcome) && outcome !== effectiveTreatment
      ? outcome
      : (observedNodes.find((id) => id !== effectiveTreatment) ?? '');

  const availableCovariates = useMemo(
    () => observedNodes.filter((id) => id !== effectiveTreatment && id !== effectiveOutcome),
    [observedNodes, effectiveTreatment, effectiveOutcome],
  );

  // Instrument/mediator track what the user picked, same fallback pattern as
  // treatment/outcome; empty string means "none selected".
  const effectiveInstrument = instrument && availableCovariates.includes(instrument) ? instrument : '';
  const effectiveMediator = mediator && availableCovariates.includes(mediator) ? mediator : '';

  // A node can't hold more than one of adjustment-covariate / instrument /
  // mediator at once -- conditioning on your own instrument, or adjusting
  // for your own mediator, doesn't make sense. Each list excludes whatever
  // the other two currently hold, and the handlers below clear the other
  // roles on selection so this stays consistent.
  const adjustmentCandidates = useMemo(
    () => availableCovariates.filter((id) => id !== effectiveInstrument && id !== effectiveMediator),
    [availableCovariates, effectiveInstrument, effectiveMediator],
  );
  const instrumentCandidates = useMemo(
    () => availableCovariates.filter((id) => !adjustmentSet.has(id) && id !== effectiveMediator),
    [availableCovariates, adjustmentSet, effectiveMediator],
  );
  const mediatorCandidates = useMemo(
    () => availableCovariates.filter((id) => !adjustmentSet.has(id) && id !== effectiveInstrument),
    [availableCovariates, adjustmentSet, effectiveInstrument],
  );

  function toggleCovariate(id: string) {
    setAdjustmentSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    if (instrument === id) setInstrument('');
    if (mediator === id) setMediator('');
  }

  function selectInstrument(id: string) {
    setInstrument(id);
    if (id) {
      setAdjustmentSet((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (mediator === id) setMediator('');
    }
  }

  function selectMediator(id: string) {
    setMediator(id);
    if (id) {
      setAdjustmentSet((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (instrument === id) setInstrument('');
    }
  }

  function copyPermalink() {
    // Encode the *sanitized* effective* values, not the raw treatment/
    // instrument/mediator state -- so a permalink never encodes a stale
    // identifier that no longer exists in the current model text (harmless
    // either way, given the same self-healing fallback on decode, but
    // pointless to encode garbage on purpose when the clean value is right
    // here).
    const encoded = encodePermalink({
      model: source,
      query: {
        treatment: effectiveTreatment,
        outcome: effectiveOutcome,
        adjustmentSet: Array.from(adjustmentSet),
        instrument: effectiveInstrument,
        mediator: effectiveMediator,
        estimand,
        ateA,
        ateB,
        degree,
        basisMode,
        bandwidth,
        lambda,
        noiseSD,
      },
      seed,
    });
    // compressToEncodedURIComponent's output is already URL-safe -- no
    // additional encodeURIComponent wrapping (that would double-encode it).
    const url = `${window.location.origin}${window.location.pathname}#${location.pathname}?state=${encoded}`;
    void navigator.clipboard.writeText(url).then(() => {
      setPermalinkCopied(true);
      setTimeout(() => setPermalinkCopied(false), 1500);
    });
  }

  // Runs mcReplicateCount replicates in batches of BATCH_SIZE via
  // setTimeout(fn, 0), so React can repaint a progress counter between
  // batches instead of blocking the main thread for the whole run (see the
  // Monte Carlo mode plan for the benchmark that justified chunking over a
  // Web Worker). Each replicate forks its own RNG stream off the same base
  // seed, the same rng.fork(streamId) convention doResponse/lateContrast
  // already use internally, rather than inventing seed arithmetic.
  function runMonteCarlo() {
    if (!run || !run.ate) return;
    const generation = ++mcGeneration.current;
    const config: MonteCarloConfig = {
      model: run.model,
      treatment: effectiveTreatment,
      outcome: effectiveOutcome,
      ateA,
      ateB,
      sampleSize: SAMPLE_SIZE,
      noiseSD,
      adjustment: run.adjustment,
      basisMode,
      degree,
      bandwidth,
      lambda,
      instrument: effectiveInstrument,
      mediator: effectiveMediator,
    };
    const total = mcReplicateCount;
    const baseRng = createRNG(seed).fork('monte-carlo');
    // Coverage checking makes each outer replicate do a whole inner bootstrap
    // (see coverageCheck.ts), much pricier than a plain replicate -- a much
    // smaller batch keeps progress updates arriving at roughly the same
    // cadence as the non-coverage case instead of going quiet for seconds.
    const BATCH_SIZE = coverageEnabled ? 2 : 25;
    const acc: MonteCarloReplicate[] = [];
    const coverageAcc: Record<string, BootstrapCIResult | null>[] = [];
    setMcRunning(true);
    setMcProgress(0);
    setMcReplicates([]);
    setMcCoverageCis([]);

    function step(i: number) {
      if (generation !== mcGeneration.current) return; // superseded by a newer run or config change
      const end = Math.min(i + BATCH_SIZE, total);
      for (let r = i; r < end; r++) {
        const rng = baseRng.fork(`mc-rep-${r}`);
        if (coverageEnabled) {
          const { estimates, cis } = runCoverageReplicate(config, coverageMethod, coverageInnerReplicates, rng);
          acc.push(estimates);
          coverageAcc.push(cis);
        } else {
          acc.push(runMonteCarloReplicate(config, rng));
        }
      }
      setMcReplicates([...acc]);
      if (coverageEnabled) setMcCoverageCis([...coverageAcc]);
      setMcProgress(end);
      if (end < total) setTimeout(() => step(end), 0);
      else setMcRunning(false);
    }
    step(0);
  }

  // Nonparametric bootstrap CIs on the *actual observed sample* (contrast
  // with Monte Carlo mode's fresh forwardSample per replicate above) -- see
  // the bootstrap CI plan for why percentile/basic/BCa all stay on the
  // table (none strictly dominates) and why BCa specifically needs a second,
  // more expensive phase: a full n-row jackknife pass for its acceleration
  // term, on top of the bootstrap pass every method needs.
  function computeConfidenceIntervals() {
    if (!run || !run.ate) return;
    const generation = ++ciGeneration.current;
    const config: EstimatorConfig = {
      treatment: effectiveTreatment,
      outcome: effectiveOutcome,
      ateA,
      ateB,
      adjustment: run.adjustment,
      basisMode,
      degree,
      bandwidth,
      lambda,
      instrument: effectiveInstrument,
      mediator: effectiveMediator,
    };
    const observed = run.observed;
    const pointEstimate = computeEstimateSet(observed, config);
    const B = ciReplicateCount;
    const needsJackknife = ciMethod === 'bca';
    const total = B + (needsJackknife ? observed.n : 0);
    const baseRng = createRNG(seed).fork('bootstrap-ci');
    const BATCH_SIZE = 25;
    const bootstrapAcc: MonteCarloReplicate[] = [];
    const jackknifeAcc: MonteCarloReplicate[] = [];
    setCiRunning(true);
    setCiProgress(0);
    setCiTotal(total);
    setCiResults(null);

    function finalize() {
      const results: Record<string, BootstrapCIResult> = {};
      (['naive', 'gcomp', 'stratify', 'ipw', 'aipw', 'iv', 'frontdoor'] as const).forEach((key) => {
        if (pointEstimate[key] === null) return; // not active for this config
        const values = bootstrapAcc.map((r) => r[key]).filter((v): v is number => v !== null);
        const failures = bootstrapAcc.length - values.length;
        const jackknife = needsJackknife ? jackknifeAcc.map((r) => r[key]).filter((v): v is number => v !== null) : null;
        results[key] = computeCI(ciMethod, pointEstimate[key]!, values, failures, jackknife);
      });
      setCiResults(results);
    }

    function bootstrapStep(i: number) {
      if (generation !== ciGeneration.current) return;
      const end = Math.min(i + BATCH_SIZE, B);
      for (let r = i; r < end; r++) {
        bootstrapAcc.push(runBootstrapReplicate(observed, config, baseRng.fork(`bootstrap-rep-${r}`)));
      }
      setCiProgress(end);
      // Live-updates with percentile/basic already available; a BCa run
      // shows a percentile-equivalent interval here (computeCI degrades to
      // percentile when the jackknife array is still empty), then sharpens
      // into the true BCa interval once the jackknife phase below finishes.
      finalize();
      if (end < B) setTimeout(() => bootstrapStep(end), 0);
      else if (needsJackknife) jackknifeStep(0);
      else setCiRunning(false);
    }

    function jackknifeStep(i: number) {
      if (generation !== ciGeneration.current) return;
      const end = Math.min(i + BATCH_SIZE, observed.n);
      for (let r = i; r < end; r++) {
        jackknifeAcc.push(runJackknifeReplicate(observed, r, config));
      }
      setCiProgress(B + end);
      finalize();
      if (end < observed.n) setTimeout(() => jackknifeStep(end), 0);
      else setCiRunning(false);
    }

    bootstrapStep(0);
  }

  const run = useMemo(() => {
    if (!parsed.ok || !effectiveTreatment || !effectiveOutcome || effectiveTreatment === effectiveOutcome) return null;
    const model = parsed.model;

    const sample = forwardSample(model, SAMPLE_SIZE, createRNG(seed), noiseSD);
    const observed = sample.observed();
    const xs = observed.columns.get(effectiveTreatment)!;
    const ys = observed.columns.get(effectiveOutcome)!;

    let gridMin = xs[0]!;
    let gridMax = xs[0]!;
    for (const x of xs) {
      if (x < gridMin) gridMin = x;
      if (x > gridMax) gridMax = x;
    }
    const grid = Array.from({ length: GRID_POINTS }, (_, i) => gridMin + ((gridMax - gridMin) * i) / (GRID_POINTS - 1));

    // The flexible-in-X basis is a toggle, not a stack: polynomial (degree
    // N) or kernel ridge (RBF, bandwidth/lambda), one or the other. Both
    // share the same (observed, treatment, outcome, adjustment, points) ->
    // {grid, ys} shape, so every call site below just dispatches on mode.
    function computeCurve(adjustment: string[], points: number[]) {
      return basisMode === 'polynomial'
        ? gcompDoseResponse(observed, effectiveTreatment, effectiveOutcome, adjustment, points, degree)
        : kernelRidgeDoseResponse(observed, effectiveTreatment, effectiveOutcome, adjustment, points, bandwidth, lambda);
    }

    // "naive" is g-computation (or kernel ridge) with an empty adjustment
    // set -- one code path for both curves at any basis, rather than a
    // separate closed-form implementation that has to stay in sync with it.
    const naiveCurve = computeCurve([], grid);
    const naiveYs = naiveCurve.ys;
    // Only a degree-1 polynomial fit has a single slope, so only fit/show
    // this in that case -- and since we authored the fit, no need to
    // numerically detect its shape the way isApproximatelyLinear does for
    // the oracle.
    const naiveSlopeFit = basisMode === 'polynomial' && degree === 1 ? fitMultivariateOLS([xs], ys) : null;

    const trueCurve = doResponse(model, effectiveTreatment, effectiveOutcome, grid, ORACLE_REPLICATES, createRNG(seed + 1000), noiseSD);
    const isLinear = isApproximatelyLinear(trueCurve);
    const trueAvgSlope = doContrast(model, effectiveTreatment, effectiveOutcome, gridMin, gridMax, ORACLE_REPLICATES, createRNG(seed + 2000), noiseSD) / (gridMax - gridMin);

    const adjustment = availableCovariates.filter((id) => adjustmentSet.has(id));
    const gcompCurve = adjustment.length > 0 ? computeCurve(adjustment, grid) : null;
    const gcompAvgSlope = gcompCurve && degree === 1 ? (gcompCurve.ys[gcompCurve.ys.length - 1]! - gcompCurve.ys[0]!) / (gridMax - gridMin) : null;

    // Identifiability gate (ARCHITECTURE.md §9/§11): report whether the
    // *current* adjustment set is a valid backdoor set, but never disable
    // the checkboxes over it -- the whole point of the gallery is letting
    // you check an invalid set and watch g-comp get it wrong anyway.
    const gate = backdoorValid(model, effectiveTreatment, effectiveOutcome, new Set(adjustment));
    const suggestedAdjustment = gate.ok ? null : findBackdoorSet(model, effectiveTreatment, effectiveOutcome);

    const naiveRmse = rmseAgainstTruth(naiveYs, trueCurve.ys);
    const gcompRmse = gcompCurve ? rmseAgainstTruth(gcompCurve.ys, trueCurve.ys) : null;

    // IV/2SLS (ARCHITECTURE.md §8): computed regardless of the instrument
    // validity verdict below -- same "annotate, don't disable" philosophy
    // as the backdoor gate. Note this recovers the LATE under effect
    // heterogeneity, not the population ATE; `trueAvgSlope`/`ate.true`
    // above are the population figure, and `trueLate` immediately below is
    // the estimand 2SLS is actually targeting -- the direct, correct
    // comparison for the divergence METHODS.md's IV/LATE section describes.
    const ivResult = effectiveInstrument ? iv2sls(observed, effectiveTreatment, effectiveOutcome, effectiveInstrument, grid) : null;
    const ivGate = effectiveInstrument ? instrumentValid(model, effectiveTreatment, effectiveOutcome, effectiveInstrument) : null;
    // True LATE: the population average of Y(do(D=1))-Y(do(D=0)) restricted
    // to compliers (units whose treatment would flip with the instrument).
    // NaN'able (see lateContrast's doc comment) if no compliers turn up in
    // the replicates -- guarded below before display.
    const trueLate = effectiveInstrument ? lateContrast(model, effectiveTreatment, effectiveOutcome, effectiveInstrument, ORACLE_REPLICATES, createRNG(seed + 4000), noiseSD) : null;

    // Front-door (ARCHITECTURE.md §8/§9, METHODS.md §4): same "annotate,
    // don't disable" philosophy as the backdoor/instrument gates above.
    const frontdoorResult = effectiveMediator ? frontdoorDoseResponse(observed, effectiveTreatment, effectiveOutcome, effectiveMediator, grid) : null;
    const frontdoorGate = effectiveMediator ? frontdoorValid(model, effectiveTreatment, effectiveOutcome, new Set([effectiveMediator])) : null;

    // IPW/AIPW (ARCHITECTURE.md §8, METHODS.md §4) are inherently binary-treatment
    // methods -- gated on the *current* treatment column's shape, not a user
    // selection, mirroring the "compute regardless, annotate/don't block" philosophy
    // iv2sls/frontdoor already use for instrument/mediator selection.
    const isBinaryTreatment = isBinaryColumn(xs);
    const ipwResult = isBinaryTreatment ? ipwAte(observed, effectiveTreatment, effectiveOutcome, adjustment, grid) : null;
    const aipwResult = isBinaryTreatment ? aipwAte(observed, effectiveTreatment, effectiveOutcome, adjustment, grid) : null;

    // stratify (ARCHITECTURE.md §8/METHODS.md §4): polynomial-in-X basis only
    // (basisMode === 'kernelRidge' has no stratify analogue, same scope
    // limitation iv2sls/frontdoor already have relative to gcomp's dual basis
    // modes). Wrapped in try/catch -- unlike every other estimator above, its
    // "too many strata" guard is easily reachable from the live UI (any
    // continuous covariate in the adjustment set trips it), so a throw here must
    // be caught and surfaced as a message, not allowed to blow up the page.
    let stratifyResult: { grid: number[]; ys: number[] } | null = null;
    let stratifyError: string | null = null;
    if (basisMode === 'polynomial' && adjustment.length > 0) {
      try {
        stratifyResult = stratifyDoseResponse(observed, effectiveTreatment, effectiveOutcome, adjustment, grid, degree);
      } catch (err) {
        stratifyError = (err as Error).message;
      }
    }
    // Same normalization as gcompAvgSlope: the raw ys[last]-ys[0] is the
    // rise over the *whole grid range* (gridMax-gridMin), not a per-unit-X
    // slope, so it must be divided down the same way to be comparable to
    // naive/g-comp/true slope's numbers.
    const stratifyAvgSlope = stratifyResult && degree === 1 ? (stratifyResult.ys[stratifyResult.ys.length - 1]! - stratifyResult.ys[0]!) / (gridMax - gridMin) : null;

    // ATE(a -> b): a direct two-point contrast, always well-defined
    // regardless of curve shape or basis degree -- no averaging-over-a-range
    // ambiguity, unlike the "avg. slope" summary above.
    let ate: { naive: number; gcomp: number | null; true: number } | null = null;
    if (estimand === 'ate' && Number.isFinite(ateA) && Number.isFinite(ateB)) {
      const naivePair = computeCurve([], [ateA, ateB]);
      const naiveAte = naivePair.ys[1]! - naivePair.ys[0]!;
      const trueAte = doContrast(model, effectiveTreatment, effectiveOutcome, ateA, ateB, ORACLE_REPLICATES, createRNG(seed + 3000), noiseSD);
      const gcompAte = adjustment.length > 0 ? (() => {
        const c = computeCurve(adjustment, [ateA, ateB]);
        return c.ys[1]! - c.ys[0]!;
      })() : null;
      ate = { naive: naiveAte, gcomp: gcompAte, true: trueAte };
    }

    return {
      model,
      observed,
      xs,
      ys,
      naiveSlopeFit,
      grid,
      naiveYs,
      trueCurve,
      isLinear,
      trueAvgSlope,
      gcompCurve,
      gcompAvgSlope,
      naiveRmse,
      gcompRmse,
      adjustment,
      ate,
      gate,
      suggestedAdjustment,
      ivResult,
      ivGate,
      trueLate,
      frontdoorResult,
      frontdoorGate,
      isBinaryTreatment,
      ipwResult,
      aipwResult,
      stratifyResult,
      stratifyAvgSlope,
      stratifyError,
    };
  }, [parsed, effectiveTreatment, effectiveOutcome, seed, adjustmentSet, availableCovariates, estimand, ateA, ateB, degree, basisMode, bandwidth, lambda, noiseSD, effectiveInstrument, effectiveMediator]);

  // A run's mcReplicates were computed against a specific frozen
  // MonteCarloConfig snapshot; if the underlying model/treatment/adjustment/
  // etc. changes underneath it, the histogram would otherwise keep showing
  // results for a config no longer on screen.
  useEffect(() => {
    mcGeneration.current += 1;
    setMcReplicates([]);
    setMcRunning(false);
    setMcProgress(0);
    setMcCoverageCis([]);
    ciGeneration.current += 1;
    setCiResults(null);
    setCiRunning(false);
    setCiProgress(0);
  }, [run]);

  // Coverage is only meaningful once a coverage-enabled run has actually
  // produced per-replicate CIs (mcCoverageCis); otherwise it's null and the
  // JSX simply doesn't render a coverage readout for that series.
  function coverageFor(key: keyof MonteCarloReplicate, trueValue: number) {
    return coverageEnabled && mcCoverageCis.length > 0 ? summarizeCoverage(mcCoverageCis.map((c) => c[key] ?? null), trueValue) : null;
  }

  const mcSeries = run?.ate
    ? [
        { key: 'naive', label: 'naive', color: '#ef4444', summary: summarizeReplicates(mcReplicates.map((r) => r.naive), run.ate.true), coverage: coverageFor('naive', run.ate.true) },
        run.adjustment.length > 0
          ? {
              key: 'gcomp',
              label: 'g-comp',
              color: '#2563eb',
              summary: summarizeReplicates(mcReplicates.map((r) => r.gcomp), run.ate.true),
              coverage: coverageFor('gcomp', run.ate.true),
            }
          : null,
        run.stratifyResult || run.stratifyError
          ? {
              key: 'stratify',
              label: 'stratify',
              color: '#0d9488',
              summary: summarizeReplicates(mcReplicates.map((r) => r.stratify), run.ate.true),
              coverage: coverageFor('stratify', run.ate.true),
            }
          : null,
        run.isBinaryTreatment
          ? {
              key: 'ipw',
              label: 'IPW',
              color: '#d97706',
              summary: summarizeReplicates(mcReplicates.map((r) => r.ipw), run.ate.true),
              coverage: coverageFor('ipw', run.ate.true),
            }
          : null,
        run.isBinaryTreatment
          ? {
              key: 'aipw',
              label: 'AIPW',
              color: '#4338ca',
              summary: summarizeReplicates(mcReplicates.map((r) => r.aipw), run.ate.true),
              coverage: coverageFor('aipw', run.ate.true),
            }
          : null,
        effectiveInstrument && run.trueLate && Number.isFinite(run.trueLate.estimate)
          ? {
              key: 'iv',
              label: '2SLS',
              color: '#7c3aed',
              summary: summarizeReplicates(mcReplicates.map((r) => r.iv), run.trueLate.estimate),
              coverage: coverageFor('iv', run.trueLate.estimate),
            }
          : null,
        effectiveMediator
          ? {
              key: 'frontdoor',
              label: 'front-door',
              color: '#db2777',
              summary: summarizeReplicates(mcReplicates.map((r) => r.frontdoor), run.ate.true),
              coverage: coverageFor('frontdoor', run.ate.true),
            }
          : null,
      ].filter((s): s is NonNullable<typeof s> => s !== null)
    : [];

  return (
    <div>
      {caption && <p style={{ color: '#334155', fontStyle: 'italic' }}>{caption}</p>}

      {decodeResult && !decodeResult.ok && (
        <p style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 8, marginBottom: 12 }}>
          Couldn't open this permalink: {describePermalinkError(decodeResult.error)} Showing the default model instead.
        </p>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setSeed((s) => s + 1)}>
          Resample (seed {seed})
        </button>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="radio" name="basisMode" checked={basisMode === 'polynomial'} onChange={() => setBasisMode('polynomial')} />
          <span style={{ color: '#475569' }}>polynomial</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="radio" name="basisMode" checked={basisMode === 'kernelRidge'} onChange={() => setBasisMode('kernelRidge')} />
          <span style={{ color: '#475569' }}>kernel ridge (RBF)</span>
        </label>
        {basisMode === 'polynomial' ? (
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ color: '#475569' }}>degree</span>
            <input type="number" value={degree} min={1} max={9} step={1} style={{ width: 56 }} onChange={(e) => setDegree(clampDegree(e.target.valueAsNumber))} />
          </label>
        ) : (
          <>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#475569' }}>bandwidth</span>
              <input
                type="number"
                value={bandwidth}
                min={0.05}
                step={0.05}
                style={{ width: 64 }}
                onChange={(e) => setBandwidth(clampBandwidth(e.target.valueAsNumber))}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span style={{ color: '#475569' }}>λ</span>
              <input
                type="number"
                value={lambda}
                min={0.0001}
                step={0.01}
                style={{ width: 64 }}
                onChange={(e) => setLambda(clampLambda(e.target.valueAsNumber))}
              />
            </label>
          </>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#475569' }}>noise σ</span>
          <input type="number" value={noiseSD} min={0} max={5} step={0.25} style={{ width: 56 }} onChange={(e) => setNoiseSD(clampNoiseSD(e.target.valueAsNumber))} />
        </label>
      </div>

      {equationStatements.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            padding: '10px 12px',
            marginBottom: 8,
            border: '1px solid #cbd5e1',
            borderRadius: 8,
            boxSizing: 'border-box',
          }}
        >
          {equationStatements.map((stmt) => (
            <MathField key={stmt.line} latex={statementToLatex(stmt)} />
          ))}
        </div>
      )}

      <textarea
        value={source}
        onChange={(e) => setSource(e.target.value)}
        spellCheck={false}
        rows={9}
        aria-label="Model source"
        style={{
          width: '100%',
          fontFamily: 'ui-monospace, monospace',
          fontSize: 14,
          padding: 12,
          border: '1px solid #cbd5e1',
          borderRadius: 8,
          boxSizing: 'border-box',
          resize: 'vertical',
        }}
      />

      {!parsed.ok && (
        <pre style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 8, marginTop: 12 }}>
          {parsed.errors.map((e) => `${e.kind}${e.line ? ` (line ${e.line})` : ''}: ${e.message}`).join('\n')}
        </pre>
      )}

      {parsed.ok && run && (
        <>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '12px 0', flexWrap: 'wrap' }}>
            <label>
              Treatment:{' '}
              <select value={effectiveTreatment} onChange={(e) => setTreatment(e.target.value)}>
                {observedNodes.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Outcome:{' '}
              <select value={effectiveOutcome} onChange={(e) => setOutcome(e.target.value)}>
                {observedNodes.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>

            {adjustmentCandidates.length > 0 && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ color: '#475569' }}>Adjust for:</span>
                {adjustmentCandidates.map((id) => (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={adjustmentSet.has(id)} onChange={() => toggleCovariate(id)} />
                    {id}
                  </label>
                ))}
              </div>
            )}

            {instrumentCandidates.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#475569' }}>Instrument (IV):</span>
                <select value={effectiveInstrument} onChange={(e) => selectInstrument(e.target.value)}>
                  <option value="">(none)</option>
                  {instrumentCandidates.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {mediatorCandidates.length > 0 && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: '#475569' }}>Mediator (front-door):</span>
                <select value={effectiveMediator} onChange={(e) => selectMediator(e.target.value)}>
                  <option value="">(none)</option>
                  {mediatorCandidates.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>

          {adjustmentCandidates.length > 0 && (
            <p style={{ margin: '0 0 4px', fontSize: 13 }}>
              {run.gate.ok ? (
                <span style={{ color: '#15803d' }}>✓ valid backdoor adjustment set</span>
              ) : (
                <span style={{ color: '#b45309' }}>
                  ✗ invalid: {run.gate.reason}
                  {run.suggestedAdjustment && (
                    <> — a valid set would be {'{' + run.suggestedAdjustment.join(', ') + '}'}</>
                  )}
                </span>
              )}
            </p>
          )}

          {run.ivGate && (
            <p style={{ margin: '0 0 12px', fontSize: 13 }}>
              {run.ivGate.ok ? (
                <span style={{ color: '#15803d' }}>✓ valid instrument</span>
              ) : (
                <span style={{ color: '#b45309' }}>✗ invalid instrument: {run.ivGate.reason}</span>
              )}
            </p>
          )}

          {run.frontdoorGate && (
            <p style={{ margin: '0 0 12px', fontSize: 13 }}>
              {run.frontdoorGate.ok ? (
                <span style={{ color: '#15803d' }}>✓ valid front-door mediator</span>
              ) : (
                <span style={{ color: '#b45309' }}>✗ invalid mediator: {run.frontdoorGate.reason}</span>
              )}
            </p>
          )}

          <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '4px 0 12px', flexWrap: 'wrap' }}>
            <span style={{ color: '#475569' }}>Estimate:</span>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="radio" name="estimand" checked={estimand === 'doseResponse'} onChange={() => setEstimand('doseResponse')} />
              dose-response curve
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="radio" name="estimand" checked={estimand === 'ate'} onChange={() => setEstimand('ate')} />
              effect from
              <input
                type="number"
                value={ateA}
                onChange={(e) => setAteA(e.target.valueAsNumber)}
                style={{ width: 64 }}
                aria-label="ATE contrast: from"
              />
              to
              <input
                type="number"
                value={ateB}
                onChange={(e) => setAteB(e.target.valueAsNumber)}
                style={{ width: 64 }}
                aria-label="ATE contrast: to"
              />
            </label>
          </div>

          <DagView model={run.model} treatment={effectiveTreatment} outcome={effectiveOutcome} adjustmentSet={adjustmentSet} />

          <div style={{ display: 'flex', gap: 24, margin: '16px 0 4px', fontFamily: 'ui-monospace, monospace', flexWrap: 'wrap' }}>
            {estimand === 'doseResponse' ? (
              <>
                {run.naiveSlopeFit && (
                  <div>
                    naive slope: <strong style={{ color: '#ef4444' }}>{run.naiveSlopeFit.coefficients[0]!.toFixed(3)}</strong>
                  </div>
                )}
                {run.gcompAvgSlope !== null && (
                  <div>
                    g-comp slope: <strong style={{ color: '#2563eb' }}>{run.gcompAvgSlope.toFixed(3)}</strong>
                  </div>
                )}
                {run.isLinear && basisMode === 'polynomial' && degree === 1 ? (
                  <div>
                    true effect (slope): <strong style={{ color: '#16a34a' }}>{run.trueAvgSlope.toFixed(3)}</strong>
                  </div>
                ) : (
                  <div style={{ color: '#92400e' }}>
                    {basisMode === 'kernelRidge'
                      ? 'kernel ridge basis — no single "slope"; see the curve, or switch to a two-point estimate below'
                      : degree > 1
                        ? 'basis degree > 1 — no single "slope"; see the curve, or switch to a two-point estimate below'
                        : 'true curve is nonlinear here — a single "slope" wouldn\'t mean much; see the chart, or switch to a two-point estimate below'}
                  </div>
                )}
              </>
            ) : run.ate ? (
              <>
                <div>
                  naive effect ({ateA}→{ateB}): <strong style={{ color: '#ef4444' }}>{run.ate.naive.toFixed(3)}</strong>
                </div>
                {run.ate.gcomp !== null && (
                  <div>
                    g-comp effect ({ateA}→{ateB}): <strong style={{ color: '#2563eb' }}>{run.ate.gcomp.toFixed(3)}</strong>
                  </div>
                )}
                <div>
                  true effect ({ateA}→{ateB}): <strong style={{ color: '#16a34a' }}>{run.ate.true.toFixed(3)}</strong>
                </div>
              </>
            ) : (
              <div style={{ color: '#92400e' }}>Enter valid numbers for both endpoints.</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 24, margin: '0 0 16px', fontFamily: 'ui-monospace, monospace', flexWrap: 'wrap', fontSize: 12.5, color: '#64748b' }}>
            <div>
              naive RMSE vs. truth: <strong>{run.naiveRmse.toFixed(3)}</strong>
            </div>
            {run.gcompRmse !== null && (
              <div>
                g-comp RMSE vs. truth: <strong>{run.gcompRmse.toFixed(3)}</strong>
              </div>
            )}
          </div>

          {run.ivResult && (
            <div style={{ display: 'flex', gap: 24, margin: '0 0 4px', fontFamily: 'ui-monospace, monospace', flexWrap: 'wrap' }}>
              <div>
                2SLS estimate (LATE, if effects are heterogeneous): <strong style={{ color: '#7c3aed' }}>{run.ivResult.estimate.toFixed(3)}</strong>
              </div>
              <div>
                first-stage F:{' '}
                <strong style={{ color: run.ivResult.firstStageF > 10 ? '#15803d' : '#b45309' }}>{run.ivResult.firstStageF.toFixed(1)}</strong>
                {run.ivResult.firstStageF <= 10 && ' (weak instrument)'}
              </div>
            </div>
          )}

          {run.trueLate && (
            <div style={{ display: 'flex', gap: 24, margin: '0 0 16px', fontFamily: 'ui-monospace, monospace', fontSize: 12.5, flexWrap: 'wrap' }}>
              {Number.isFinite(run.trueLate.estimate) ? (
                <div style={{ color: '#64748b' }}>
                  true LATE (compliers only, {(run.trueLate.complierShare * 100).toFixed(0)}% of the population):{' '}
                  <strong style={{ color: '#16a34a' }}>{run.trueLate.estimate.toFixed(3)}</strong> — compare 2SLS to <em>this</em>, not to the
                  population "true effect" above; they're different estimands whenever effects are heterogeneous across compliance types.
                </div>
              ) : (
                <div style={{ color: '#b45309' }}>no compliers found in this sample — can't compute a true LATE to compare against</div>
              )}
            </div>
          )}

          {run.frontdoorResult && (
            <div style={{ display: 'flex', gap: 24, margin: '0 0 16px', fontFamily: 'ui-monospace, monospace', flexWrap: 'wrap' }}>
              <div>
                front-door estimate: <strong style={{ color: '#db2777' }}>{run.frontdoorResult.estimate.toFixed(3)}</strong>
              </div>
            </div>
          )}

          {run.stratifyAvgSlope !== null && (
            <div style={{ display: 'flex', gap: 24, margin: '0 0 4px', fontFamily: 'ui-monospace, monospace', flexWrap: 'wrap' }}>
              <div>
                stratify slope: <strong style={{ color: '#0d9488' }}>{run.stratifyAvgSlope.toFixed(3)}</strong>
              </div>
            </div>
          )}
          {run.stratifyError && <p style={{ margin: '0 0 16px', fontSize: 13, color: '#b45309' }}>✗ stratify: {run.stratifyError}</p>}

          {run.ipwResult && (
            <div style={{ display: 'flex', gap: 24, margin: '0 0 4px', fontFamily: 'ui-monospace, monospace', flexWrap: 'wrap' }}>
              <div>
                IPW ATE: <strong style={{ color: '#d97706' }}>{run.ipwResult.estimate.toFixed(3)}</strong>
              </div>
              <div>
                min overlap:{' '}
                <strong style={{ color: run.ipwResult.minOverlap > 0.1 ? '#15803d' : '#b45309' }}>{run.ipwResult.minOverlap.toFixed(3)}</strong>
                {run.ipwResult.minOverlap <= 0.1 && ' (poor overlap -- estimate may be unstable)'}
              </div>
              <div style={{ color: '#64748b', fontSize: 12.5 }}>
                effective N (treated/control): {run.ipwResult.effectiveSampleSizeTreated.toFixed(0)} / {run.ipwResult.effectiveSampleSizeControl.toFixed(0)}
              </div>
            </div>
          )}

          {run.aipwResult && (
            <div style={{ display: 'flex', gap: 24, margin: '0 0 16px', fontFamily: 'ui-monospace, monospace', flexWrap: 'wrap' }}>
              <div>
                AIPW ATE: <strong style={{ color: '#4338ca' }}>{run.aipwResult.estimate.toFixed(3)}</strong>
              </div>
              <div style={{ color: '#64748b', fontSize: 12.5 }}>
                min overlap: {run.aipwResult.minOverlap.toFixed(3)}, effective N: {run.aipwResult.effectiveSampleSizeTreated.toFixed(0)} /{' '}
                {run.aipwResult.effectiveSampleSizeControl.toFixed(0)}
              </div>
            </div>
          )}

          {estimand === 'ate' && run.ate && (
            <div style={{ margin: '0 0 16px', padding: 12, border: '1px solid #cbd5e1', borderRadius: 8 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
                <strong style={{ color: '#334155' }}>Monte Carlo mode</strong>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: '#475569' }}>replicates</span>
                  <input
                    type="number"
                    value={mcReplicateCount}
                    min={10}
                    max={1000}
                    step={10}
                    style={{ width: 72 }}
                    onChange={(e) => setMcReplicateCount(clampReplicateCount(e.target.valueAsNumber))}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="checkbox" checked={coverageEnabled} onChange={(e) => setCoverageEnabled(e.target.checked)} />
                  <span style={{ color: '#475569' }}>check CI coverage (slower)</span>
                </label>
                {coverageEnabled && (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="radio" name="coverageMethod" checked={coverageMethod === 'percentile'} onChange={() => setCoverageMethod('percentile')} />
                      <span style={{ color: '#475569' }}>percentile</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <input type="radio" name="coverageMethod" checked={coverageMethod === 'basic'} onChange={() => setCoverageMethod('basic')} />
                      <span style={{ color: '#475569' }}>basic</span>
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ color: '#475569' }}>inner resamples</span>
                      <input
                        type="number"
                        value={coverageInnerReplicates}
                        min={10}
                        max={100}
                        step={5}
                        style={{ width: 64 }}
                        onChange={(e) => setCoverageInnerReplicates(clampCoverageInnerReplicates(e.target.valueAsNumber))}
                      />
                    </label>
                  </>
                )}
                <button type="button" onClick={runMonteCarlo} disabled={mcRunning}>
                  {mcRunning ? `Running... (${mcProgress}/${mcReplicateCount})` : 'Run Monte Carlo'}
                </button>
              </div>

              {coverageEnabled && (
                <p style={{ margin: '0 0 8px', fontSize: 12.5, color: '#64748b' }}>
                  For each replicate, also bootstraps a small confidence interval around that replicate&apos;s own sample and checks whether it
                  contains the true effect -- coverage should land near 95% for a well-specified estimator, and visibly lower for a misspecified
                  one. Multiplies cost by the inner resample count above (a full run can take several seconds to tens of seconds); BCa isn&apos;t
                  offered here since its jackknife pass would make this infeasible.
                </p>
              )}

              {mcReplicates.length > 0 && (
                <>
                  <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontFamily: 'ui-monospace, monospace', fontSize: 12.5, marginBottom: 8 }}>
                    {mcSeries.map((s) => (
                      <div key={s.key} style={{ color: s.color }}>
                        {s.label}: bias {s.summary.bias.toFixed(3)}, RMSE {s.summary.rmse.toFixed(3)}
                        {s.summary.failures > 0 && ` (${s.summary.failures}/${mcReplicates.length} failed)`}
                        {s.coverage && !Number.isNaN(s.coverage.rate) && (
                          <span style={{ color: Math.abs(s.coverage.rate - 0.95) <= 0.1 ? '#15803d' : '#b45309' }}>
                            {' | coverage '}
                            {(s.coverage.rate * 100).toFixed(1)}% (target 95%)
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                  <MonteCarloChart
                    series={mcSeries.map((s) => ({ key: s.key, label: s.label, color: s.color, values: s.summary.values }))}
                    referenceLines={[
                      { value: run.ate.true, label: 'true ATE', color: '#16a34a' },
                      ...(mcSeries.some((s) => s.key === 'iv') ? [{ value: run.trueLate!.estimate, label: 'true LATE', color: '#7c3aed' }] : []),
                    ]}
                  />
                </>
              )}
            </div>
          )}

          {estimand === 'ate' && run.ate && (
            <div style={{ margin: '0 0 16px', padding: 12, border: '1px solid #cbd5e1', borderRadius: 8 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 4, flexWrap: 'wrap' }}>
                <strong style={{ color: '#334155' }}>Confidence intervals</strong>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="radio" name="ciMethod" checked={ciMethod === 'percentile'} onChange={() => setCiMethod('percentile')} />
                  <span style={{ color: '#475569' }}>percentile</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="radio" name="ciMethod" checked={ciMethod === 'basic'} onChange={() => setCiMethod('basic')} />
                  <span style={{ color: '#475569' }}>basic</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input type="radio" name="ciMethod" checked={ciMethod === 'bca'} onChange={() => setCiMethod('bca')} />
                  <span style={{ color: '#475569' }}>BCa</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ color: '#475569' }}>resamples</span>
                  <input
                    type="number"
                    value={ciReplicateCount}
                    min={10}
                    max={1000}
                    step={10}
                    style={{ width: 72 }}
                    onChange={(e) => setCiReplicateCount(clampReplicateCount(e.target.valueAsNumber))}
                  />
                </label>
                <button type="button" onClick={computeConfidenceIntervals} disabled={ciRunning}>
                  {ciRunning ? `Computing... (${ciProgress}/${ciTotal})` : 'Compute CIs'}
                </button>
              </div>
              <p style={{ margin: '0 0 8px', fontSize: 12.5, color: '#64748b' }}>
                Nonparametric bootstrap on your actual {SAMPLE_SIZE}-row sample -- this is what you could compute from real data alone, unlike
                the &quot;true&quot; reference lines above.
                {ciMethod === 'bca' && ' BCa additionally jackknifes the full sample (one refit per row), so it takes longer.'}
              </p>
              {ciResults && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2, fontFamily: 'ui-monospace, monospace', fontSize: 12.5 }}>
                  {Object.entries(ciResults).map(([key, ci]) => (
                    <div key={key}>
                      {key}: {ci.estimate.toFixed(3)}{' '}
                      {ci.lower !== null && ci.upper !== null ? (
                        <>
                          95% CI [{ci.lower.toFixed(3)}, {ci.upper.toFixed(3)}]
                        </>
                      ) : (
                        <span style={{ color: '#b45309' }}>
                          insufficient successful resamples ({ci.replicates}/{ci.replicates + ci.failures})
                        </span>
                      )}
                      {ci.failures > 0 && ci.lower !== null && (
                        <span style={{ color: '#64748b' }}> ({ci.failures} resample{ci.failures === 1 ? '' : 's'} failed)</span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <ComparisonChart
            xs={run.xs}
            ys={run.ys}
            naiveGrid={run.grid}
            naiveYs={run.naiveYs}
            trueGrid={run.trueCurve.xs}
            trueYs={run.trueCurve.ys}
            gcomp={
              run.gcompCurve
                ? {
                    grid: run.gcompCurve.grid,
                    ys: run.gcompCurve.ys,
                    label: `g-comp adjusting for {${run.adjustment.join(', ')}} (${basisMode === 'polynomial' ? `poly deg ${degree}` : `RBF bw=${bandwidth}, λ=${lambda}`})`,
                  }
                : null
            }
            iv={run.ivResult ? { grid: run.ivResult.grid, ys: run.ivResult.ys, label: `2SLS via ${effectiveInstrument}` } : null}
            frontdoor={run.frontdoorResult ? { grid: run.frontdoorResult.grid, ys: run.frontdoorResult.ys, label: `front-door via ${effectiveMediator}` } : null}
            stratify={run.stratifyResult ? { grid: run.stratifyResult.grid, ys: run.stratifyResult.ys, label: `stratify by {${run.adjustment.join(', ')}}` } : null}
            ipw={run.ipwResult ? { grid: run.ipwResult.grid, ys: run.ipwResult.ys, label: `IPW via {${run.adjustment.join(', ')}}` } : null}
            aipw={run.aipwResult ? { grid: run.aipwResult.grid, ys: run.aipwResult.ys, label: `AIPW via {${run.adjustment.join(', ')}}` } : null}
            treatment={effectiveTreatment}
            outcome={effectiveOutcome}
          />

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0 0', flexWrap: 'wrap' }}>
            <span style={{ color: '#475569', fontSize: 13 }}>Export:</span>
            <button type="button" onClick={() => downloadFile('model.scm', source, 'text/plain')}>
              model (.scm)
            </button>
            <button type="button" onClick={() => downloadFile('sample.csv', sampleToCsv(run.observed), 'text/csv')}>
              sample (CSV)
            </button>
            <button
              type="button"
              onClick={() => downloadFile('dag.svg', modelToSvg(run.model, effectiveTreatment, effectiveOutcome, adjustmentSet), 'image/svg+xml')}
            >
              DAG (SVG)
            </button>
            <button
              type="button"
              onClick={() =>
                downloadFile(
                  'analysis.py',
                  modelToPython({
                    source,
                    model: run.model,
                    treatment: effectiveTreatment,
                    outcome: effectiveOutcome,
                    adjustmentSet,
                    instrument: effectiveInstrument || null,
                    mediator: effectiveMediator || null,
                    basisMode,
                    degree,
                    bandwidth,
                    lambda,
                    seed,
                    noiseSD,
                    sampleSize: SAMPLE_SIZE,
                    isBinaryTreatment: run.isBinaryTreatment,
                    includeStratify: run.stratifyResult !== null,
                  }),
                  'text/x-python',
                )
              }
            >
              analysis (Python)
            </button>
            <button type="button" onClick={copyPermalink}>
              {permalinkCopied ? 'Copied!' : 'copy permalink'}
            </button>
          </div>
        </>
      )}

      {parsed.ok && !run && <p style={{ color: '#b45309' }}>Need at least two distinct observed nodes to compare treatment against outcome.</p>}
    </div>
  );
}
