import PlotModule from 'react-plotly.js';

// Vite's CJS->ESM interop for this package double-wraps the export --
// `import Plot from 'react-plotly.js'` otherwise resolves to the raw
// `{ __esModule: true, default: PlotComponent }` object rather than the
// component itself, which crashes React with "Element type is invalid".
const Plot = ((PlotModule as unknown as { default?: typeof PlotModule }).default ?? PlotModule) as typeof PlotModule;

interface ComparisonChartProps {
  xs: Float64Array;
  ys: Float64Array;
  naiveGrid: number[];
  naiveYs: number[];
  trueGrid: number[];
  trueYs: number[];
  gcomp?: { grid: number[]; ys: number[]; label: string } | null;
  iv?: { grid: number[]; ys: number[]; label: string } | null;
  frontdoor?: { grid: number[]; ys: number[]; label: string } | null;
  stratify?: { grid: number[]; ys: number[]; label: string } | null;
  ipw?: { grid: number[]; ys: number[]; label: string } | null;
  aipw?: { grid: number[]; ys: number[]; label: string } | null;
  treatment: string;
  outcome: string;
}

export function ComparisonChart({ xs, ys, naiveGrid, naiveYs, trueGrid, trueYs, gcomp, iv, frontdoor, stratify, ipw, aipw, treatment, outcome }: ComparisonChartProps) {
  return (
    <Plot
      data={[
        {
          x: Array.from(xs),
          y: Array.from(ys),
          mode: 'markers',
          type: 'scatter',
          name: 'sampled data',
          marker: { color: '#94a3b8', size: 5, opacity: 0.5 },
        },
        {
          x: trueGrid,
          y: trueYs,
          mode: 'lines',
          type: 'scatter',
          name: 'true E[Y | do(X=x)]',
          line: { color: '#16a34a', width: 3, dash: 'dash' },
        },
        {
          // fill: 'tonexty' shades the region between this trace and the
          // one immediately before it in this array (the true curve) --
          // requires naiveGrid/trueGrid to share the same x values, which
          // they do (both come from the same `grid` in PlaygroundView).
          x: naiveGrid,
          y: naiveYs,
          mode: 'lines',
          type: 'scatter',
          name: 'naive (unadjusted) fit',
          line: { color: '#ef4444', width: 3 },
          fill: 'tonexty',
          fillcolor: 'rgba(239, 68, 68, 0.08)',
        },
        ...(gcomp
          ? [
              {
                x: gcomp.grid,
                y: gcomp.ys,
                mode: 'lines' as const,
                type: 'scatter' as const,
                name: gcomp.label,
                line: { color: '#2563eb', width: 3, dash: 'dot' as const },
              },
            ]
          : []),
        ...(iv
          ? [
              {
                x: iv.grid,
                y: iv.ys,
                mode: 'lines' as const,
                type: 'scatter' as const,
                name: iv.label,
                line: { color: '#7c3aed', width: 3, dash: 'dashdot' as const },
              },
            ]
          : []),
        ...(frontdoor
          ? [
              {
                x: frontdoor.grid,
                y: frontdoor.ys,
                mode: 'lines' as const,
                type: 'scatter' as const,
                name: frontdoor.label,
                line: { color: '#db2777', width: 3, dash: 'longdashdot' as const },
              },
            ]
          : []),
        ...(stratify
          ? [
              {
                x: stratify.grid,
                y: stratify.ys,
                mode: 'lines' as const,
                type: 'scatter' as const,
                name: stratify.label,
                line: { color: '#0d9488', width: 3, dash: 'longdash' as const },
              },
            ]
          : []),
        ...(ipw
          ? [
              {
                x: ipw.grid,
                y: ipw.ys,
                mode: 'lines' as const,
                type: 'scatter' as const,
                name: ipw.label,
                line: { color: '#d97706', width: 3, dash: 'dot' as const },
              },
            ]
          : []),
        ...(aipw
          ? [
              {
                x: aipw.grid,
                y: aipw.ys,
                mode: 'lines' as const,
                type: 'scatter' as const,
                name: aipw.label,
                line: { color: '#4338ca', width: 3, dash: 'dashdot' as const },
              },
            ]
          : []),
      ]}
      layout={{
        autosize: true,
        height: 420,
        margin: { l: 55, r: 20, t: 20, b: 45 },
        xaxis: { title: { text: treatment } },
        yaxis: { title: { text: outcome } },
        legend: { orientation: 'h', y: -0.2 },
      }}
      style={{ width: '100%' }}
      useResizeHandler
      config={{ displaylogo: false, responsive: true }}
    />
  );
}
