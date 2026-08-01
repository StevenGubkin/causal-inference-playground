import { useMemo, useState } from 'react';
import { createRNG, doContrast, doResponse, forwardSample } from 'scm-engine';
import { fitSimpleLinearRegression, gcompDoseResponse, predictOverGrid } from 'estimators';
import { parseModel } from 'scm-dsl';
import { ComparisonChart } from './ComparisonChart';
import { DagView } from './DagView';
import { PRESETS } from './presets';

const SAMPLE_SIZE = 500;
const ORACLE_REPLICATES = 3000;
const GRID_POINTS = 25;

export default function App() {
  const [presetId, setPresetId] = useState(PRESETS[0]!.id);
  const [seed, setSeed] = useState(1);
  const [adjustmentSet, setAdjustmentSet] = useState<Set<string>>(new Set());

  const preset = PRESETS.find((p) => p.id === presetId)!;

  const parsed = useMemo(() => parseModel(preset.source), [preset.source]);

  const availableCovariates = useMemo(() => {
    if (!parsed.ok) return [];
    return parsed.model.observed().filter((id) => id !== preset.treatment && id !== preset.outcome);
  }, [parsed, preset.treatment, preset.outcome]);

  function selectPreset(id: string) {
    setPresetId(id);
    setAdjustmentSet(new Set());
  }

  function toggleCovariate(id: string) {
    setAdjustmentSet((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const run = useMemo(() => {
    if (!parsed.ok) return null;
    const model = parsed.model;

    const sample = forwardSample(model, SAMPLE_SIZE, createRNG(seed));
    const observed = sample.observed();
    const xs = observed.columns.get(preset.treatment)!;
    const ys = observed.columns.get(preset.outcome)!;

    const naiveFit = fitSimpleLinearRegression(xs, ys);

    let gridMin = xs[0]!;
    let gridMax = xs[0]!;
    for (const x of xs) {
      if (x < gridMin) gridMin = x;
      if (x > gridMax) gridMax = x;
    }
    const grid = Array.from({ length: GRID_POINTS }, (_, i) => gridMin + ((gridMax - gridMin) * i) / (GRID_POINTS - 1));
    const naiveYs = predictOverGrid(naiveFit, grid);

    const trueCurve = doResponse(model, preset.treatment, preset.outcome, grid, ORACLE_REPLICATES, createRNG(seed + 1000));
    const trueEffect = doContrast(model, preset.treatment, preset.outcome, gridMin, gridMax, ORACLE_REPLICATES, createRNG(seed + 2000)) / (gridMax - gridMin);

    const adjustment = [...adjustmentSet];
    const gcompCurve = adjustment.length > 0 ? gcompDoseResponse(observed, preset.treatment, preset.outcome, adjustment, grid) : null;
    const gcompEffect = gcompCurve ? (gcompCurve.ys[gcompCurve.ys.length - 1]! - gcompCurve.ys[0]!) / (gridMax - gridMin) : null;

    return { model, xs, ys, naiveFit, grid, naiveYs, trueCurve, trueEffect, gcompCurve, gcompEffect, adjustment };
  }, [parsed, preset.treatment, preset.outcome, seed, adjustmentSet]);

  return (
    <main style={{ maxWidth: 980, margin: '0 auto', padding: '24px 16px', fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1 style={{ marginBottom: 4 }}>Causal Inference Playground</h1>
      <p style={{ color: '#475569', marginTop: 0 }}>
        Sampled data vs. the naive fit vs. the true interventional curve — the one thing you never get with real data.
      </p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '16px 0', flexWrap: 'wrap' }}>
        <label>
          Model:{' '}
          <select value={presetId} onChange={(e) => selectPreset(e.target.value)}>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => setSeed((s) => s + 1)}>
          Resample (seed {seed})
        </button>

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

      <p style={{ color: '#334155', fontStyle: 'italic' }}>{preset.caption}</p>

      {!parsed.ok && (
        <pre style={{ background: '#fef2f2', color: '#991b1b', padding: 12, borderRadius: 8 }}>
          {parsed.errors.map((e) => `${e.kind}${e.line ? ` (line ${e.line})` : ''}: ${e.message}`).join('\n')}
        </pre>
      )}

      {parsed.ok && run && (
        <>
          <DagView model={run.model} treatment={preset.treatment} outcome={preset.outcome} />

          <div style={{ display: 'flex', gap: 24, margin: '16px 0', fontFamily: 'ui-monospace, monospace' }}>
            <div>
              naive slope: <strong style={{ color: '#ef4444' }}>{run.naiveFit.slope.toFixed(3)}</strong>
            </div>
            {run.gcompEffect !== null && (
              <div>
                g-comp slope: <strong style={{ color: '#2563eb' }}>{run.gcompEffect.toFixed(3)}</strong>
              </div>
            )}
            <div>
              true effect (avg. slope): <strong style={{ color: '#16a34a' }}>{run.trueEffect.toFixed(3)}</strong>
            </div>
          </div>

          <ComparisonChart
            xs={run.xs}
            ys={run.ys}
            naiveGrid={run.grid}
            naiveYs={run.naiveYs}
            trueGrid={run.trueCurve.xs}
            trueYs={run.trueCurve.ys}
            gcomp={run.gcompCurve ? { grid: run.gcompCurve.grid, ys: run.gcompCurve.ys, label: `g-comp adjusting for {${run.adjustment.join(', ')}}` } : null}
            treatment={preset.treatment}
            outcome={preset.outcome}
          />
        </>
      )}
    </main>
  );
}
