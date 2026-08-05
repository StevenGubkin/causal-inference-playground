import { useEffect, useMemo, useState } from 'react';
import { createRNG, doContrast, doResponse, forwardSample } from 'scm-engine';
import type { Curve } from 'scm-engine';
import { fitMultivariateOLS, frontdoorDoseResponse, gcompDoseResponse, iv2sls, kernelRidgeDoseResponse } from 'estimators';
import { backdoorValid, findBackdoorSet, frontdoorValid, instrumentValid } from 'graph';
import { parseModel } from 'scm-dsl';
import { ComparisonChart } from './ComparisonChart';
import { DagView } from './DagView';

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
  const [source, setSource] = useState(initialSource);
  const [treatment, setTreatment] = useState(initialTreatment);
  const [outcome, setOutcome] = useState(initialOutcome);
  const [adjustmentSet, setAdjustmentSet] = useState<Set<string>>(new Set());
  const [instrument, setInstrument] = useState('');
  const [mediator, setMediator] = useState('');
  const [seed, setSeed] = useState(1);
  const [estimand, setEstimand] = useState<Estimand>('doseResponse');
  const [ateA, setAteA] = useState(0);
  const [ateB, setAteB] = useState(1);
  const [degree, setDegree] = useState(1);
  const [basisMode, setBasisMode] = useState<BasisMode>('polynomial');
  const [bandwidth, setBandwidth] = useState(1);
  const [lambda, setLambda] = useState(0.1);
  const [noiseSD, setNoiseSD] = useState(1);

  const debouncedSource = useDebouncedValue(source, SOURCE_DEBOUNCE_MS);
  const parsed = useMemo(() => parseModel(debouncedSource), [debouncedSource]);

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
    // above are what to compare it against to see that divergence.
    const ivResult = effectiveInstrument ? iv2sls(observed, effectiveTreatment, effectiveOutcome, effectiveInstrument, grid) : null;
    const ivGate = effectiveInstrument ? instrumentValid(model, effectiveTreatment, effectiveOutcome, effectiveInstrument) : null;

    // Front-door (ARCHITECTURE.md §8/§9, METHODS.md §4): same "annotate,
    // don't disable" philosophy as the backdoor/instrument gates above.
    const frontdoorResult = effectiveMediator ? frontdoorDoseResponse(observed, effectiveTreatment, effectiveOutcome, effectiveMediator, grid) : null;
    const frontdoorGate = effectiveMediator ? frontdoorValid(model, effectiveTreatment, effectiveOutcome, new Set([effectiveMediator])) : null;

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

    return { model, xs, ys, naiveSlopeFit, grid, naiveYs, trueCurve, isLinear, trueAvgSlope, gcompCurve, gcompAvgSlope, naiveRmse, gcompRmse, adjustment, ate, gate, suggestedAdjustment, ivResult, ivGate, frontdoorResult, frontdoorGate };
  }, [parsed, effectiveTreatment, effectiveOutcome, seed, adjustmentSet, availableCovariates, estimand, ateA, ateB, degree, basisMode, bandwidth, lambda, noiseSD, effectiveInstrument, effectiveMediator]);

  return (
    <div>
      {caption && <p style={{ color: '#334155', fontStyle: 'italic' }}>{caption}</p>}

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
            <input type="number" value={degree} min={1} max={9} step={1} style={{ width: 56 }} onChange={(e) => setDegree(Math.round(e.target.valueAsNumber) || 1)} />
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
                onChange={(e) => setBandwidth(Math.max(0.05, e.target.valueAsNumber) || 1)}
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
                onChange={(e) => setLambda(Math.max(0.0001, e.target.valueAsNumber) || 0.0001)}
              />
            </label>
          </>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span style={{ color: '#475569' }}>noise σ</span>
          <input type="number" value={noiseSD} min={0} max={5} step={0.25} style={{ width: 56 }} onChange={(e) => setNoiseSD(e.target.valueAsNumber)} />
        </label>
      </div>

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
            <div style={{ display: 'flex', gap: 24, margin: '0 0 16px', fontFamily: 'ui-monospace, monospace', flexWrap: 'wrap' }}>
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

          {run.frontdoorResult && (
            <div style={{ display: 'flex', gap: 24, margin: '0 0 16px', fontFamily: 'ui-monospace, monospace', flexWrap: 'wrap' }}>
              <div>
                front-door estimate: <strong style={{ color: '#db2777' }}>{run.frontdoorResult.estimate.toFixed(3)}</strong>
              </div>
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
            treatment={effectiveTreatment}
            outcome={effectiveOutcome}
          />
        </>
      )}

      {parsed.ok && !run && <p style={{ color: '#b45309' }}>Need at least two distinct observed nodes to compare treatment against outcome.</p>}
    </div>
  );
}
