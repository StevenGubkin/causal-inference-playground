import { useEffect, useMemo, useState } from 'react';
import { createRNG, doContrast, doResponse, forwardSample } from 'scm-engine';
import type { Curve } from 'scm-engine';
import { fitSimpleLinearRegression, gcompDoseResponse, predictOverGrid } from 'estimators';
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

type Estimand = 'doseResponse' | 'ate';

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
  const [seed, setSeed] = useState(1);
  const [estimand, setEstimand] = useState<Estimand>('doseResponse');
  const [ateA, setAteA] = useState(0);
  const [ateB, setAteB] = useState(1);

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

  function toggleCovariate(id: string) {
    setAdjustmentSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const run = useMemo(() => {
    if (!parsed.ok || !effectiveTreatment || !effectiveOutcome || effectiveTreatment === effectiveOutcome) return null;
    const model = parsed.model;

    const sample = forwardSample(model, SAMPLE_SIZE, createRNG(seed));
    const observed = sample.observed();
    const xs = observed.columns.get(effectiveTreatment)!;
    const ys = observed.columns.get(effectiveOutcome)!;

    const naiveFit = fitSimpleLinearRegression(xs, ys);

    let gridMin = xs[0]!;
    let gridMax = xs[0]!;
    for (const x of xs) {
      if (x < gridMin) gridMin = x;
      if (x > gridMax) gridMax = x;
    }
    const grid = Array.from({ length: GRID_POINTS }, (_, i) => gridMin + ((gridMax - gridMin) * i) / (GRID_POINTS - 1));
    const naiveYs = predictOverGrid(naiveFit, grid);

    const trueCurve = doResponse(model, effectiveTreatment, effectiveOutcome, grid, ORACLE_REPLICATES, createRNG(seed + 1000));
    const isLinear = isApproximatelyLinear(trueCurve);
    const trueAvgSlope = doContrast(model, effectiveTreatment, effectiveOutcome, gridMin, gridMax, ORACLE_REPLICATES, createRNG(seed + 2000)) / (gridMax - gridMin);

    const adjustment = availableCovariates.filter((id) => adjustmentSet.has(id));
    const gcompCurve = adjustment.length > 0 ? gcompDoseResponse(observed, effectiveTreatment, effectiveOutcome, adjustment, grid) : null;
    const gcompAvgSlope = gcompCurve ? (gcompCurve.ys[gcompCurve.ys.length - 1]! - gcompCurve.ys[0]!) / (gridMax - gridMin) : null;

    // ATE(a -> b): a direct two-point contrast, always well-defined
    // regardless of whether the curve is linear -- no averaging-over-a-range
    // ambiguity, unlike the "avg. slope" summary above.
    let ate: { naive: number; gcomp: number | null; true: number } | null = null;
    if (estimand === 'ate' && Number.isFinite(ateA) && Number.isFinite(ateB)) {
      const naiveAte = naiveFit.slope * (ateB - ateA);
      const trueAte = doContrast(model, effectiveTreatment, effectiveOutcome, ateA, ateB, ORACLE_REPLICATES, createRNG(seed + 3000));
      const gcompAte = adjustment.length > 0 ? (() => {
        const c = gcompDoseResponse(observed, effectiveTreatment, effectiveOutcome, adjustment, [ateA, ateB]);
        return c.ys[1]! - c.ys[0]!;
      })() : null;
      ate = { naive: naiveAte, gcomp: gcompAte, true: trueAte };
    }

    return { model, xs, ys, naiveFit, grid, naiveYs, trueCurve, isLinear, trueAvgSlope, gcompCurve, gcompAvgSlope, adjustment, ate };
  }, [parsed, effectiveTreatment, effectiveOutcome, seed, adjustmentSet, availableCovariates, estimand, ateA, ateB]);

  return (
    <div>
      {caption && <p style={{ color: '#334155', fontStyle: 'italic' }}>{caption}</p>}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
        <button type="button" onClick={() => setSeed((s) => s + 1)}>
          Resample (seed {seed})
        </button>
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

            {availableCovariates.length > 0 && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <span style={{ color: '#475569' }}>Adjust for:</span>
                {availableCovariates.map((id) => (
                  <label key={id} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <input type="checkbox" checked={adjustmentSet.has(id)} onChange={() => toggleCovariate(id)} />
                    {id}
                  </label>
                ))}
              </div>
            )}
          </div>

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

          <DagView model={run.model} treatment={effectiveTreatment} outcome={effectiveOutcome} />

          <div style={{ display: 'flex', gap: 24, margin: '16px 0', fontFamily: 'ui-monospace, monospace', flexWrap: 'wrap' }}>
            {estimand === 'doseResponse' ? (
              <>
                <div>
                  naive slope: <strong style={{ color: '#ef4444' }}>{run.naiveFit.slope.toFixed(3)}</strong>
                </div>
                {run.gcompAvgSlope !== null && (
                  <div>
                    g-comp slope: <strong style={{ color: '#2563eb' }}>{run.gcompAvgSlope.toFixed(3)}</strong>
                  </div>
                )}
                {run.isLinear ? (
                  <div>
                    true effect (slope): <strong style={{ color: '#16a34a' }}>{run.trueAvgSlope.toFixed(3)}</strong>
                  </div>
                ) : (
                  <div style={{ color: '#92400e' }}>true curve is nonlinear here — a single "slope" wouldn't mean much; see the chart, or switch to a two-point estimate below</div>
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

          <ComparisonChart
            xs={run.xs}
            ys={run.ys}
            naiveGrid={run.grid}
            naiveYs={run.naiveYs}
            trueGrid={run.trueCurve.xs}
            trueYs={run.trueCurve.ys}
            gcomp={run.gcompCurve ? { grid: run.gcompCurve.grid, ys: run.gcompCurve.ys, label: `g-comp adjusting for {${run.adjustment.join(', ')}}` } : null}
            treatment={effectiveTreatment}
            outcome={effectiveOutcome}
          />
        </>
      )}

      {parsed.ok && !run && <p style={{ color: '#b45309' }}>Need at least two distinct observed nodes to compare treatment against outcome.</p>}
    </div>
  );
}
