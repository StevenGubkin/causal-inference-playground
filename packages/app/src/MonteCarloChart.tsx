import PlotModule from 'react-plotly.js';

// Vite's CJS->ESM interop for this package double-wraps the export --
// `import Plot from 'react-plotly.js'` otherwise resolves to the raw
// `{ __esModule: true, default: PlotComponent }` object rather than the
// component itself, which crashes React with "Element type is invalid".
const Plot = ((PlotModule as unknown as { default?: typeof PlotModule }).default ?? PlotModule) as typeof PlotModule;

export interface MonteCarloSeries {
  key: string;
  label: string;
  color: string;
  values: number[];
}

export interface MonteCarloReferenceLine {
  value: number;
  label: string;
  color: string;
}

interface MonteCarloChartProps {
  series: MonteCarloSeries[];
  referenceLines: MonteCarloReferenceLine[];
}

export function MonteCarloChart({ series, referenceLines }: MonteCarloChartProps) {
  return (
    <Plot
      data={series
        .filter((s) => s.values.length > 0)
        .map((s) => ({
          x: s.values,
          type: 'histogram' as const,
          name: s.label,
          opacity: 0.6,
          marker: { color: s.color },
        }))}
      layout={{
        autosize: true,
        height: 420,
        margin: { l: 55, r: 20, t: 20, b: 45 },
        barmode: 'overlay',
        xaxis: { title: { text: 'estimate' } },
        yaxis: { title: { text: 'replicates' } },
        legend: { orientation: 'h', y: -0.2 },
        shapes: referenceLines.map((r) => ({
          type: 'line' as const,
          x0: r.value,
          x1: r.value,
          y0: 0,
          y1: 1,
          yref: 'paper' as const,
          line: { color: r.color, width: 2, dash: 'dash' as const },
        })),
        annotations: referenceLines.map((r) => ({
          x: r.value,
          y: 1,
          yref: 'paper' as const,
          showarrow: false,
          text: r.label,
          font: { color: r.color, size: 11 },
          yshift: 10,
        })),
      }}
      style={{ width: '100%' }}
      useResizeHandler
      config={{ displaylogo: false, responsive: true }}
    />
  );
}
