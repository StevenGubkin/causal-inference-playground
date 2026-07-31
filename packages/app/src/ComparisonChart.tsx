import Plot from 'react-plotly.js';

interface ComparisonChartProps {
  xs: Float64Array;
  ys: Float64Array;
  naiveGrid: number[];
  naiveYs: number[];
  trueGrid: number[];
  trueYs: number[];
  treatment: string;
  outcome: string;
}

export function ComparisonChart({ xs, ys, naiveGrid, naiveYs, trueGrid, trueYs, treatment, outcome }: ComparisonChartProps) {
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
          x: naiveGrid,
          y: naiveYs,
          mode: 'lines',
          type: 'scatter',
          name: 'naive (unadjusted) fit',
          line: { color: '#ef4444', width: 3 },
        },
        {
          x: trueGrid,
          y: trueYs,
          mode: 'lines',
          type: 'scatter',
          name: 'true E[Y | do(X=x)]',
          line: { color: '#16a34a', width: 3, dash: 'dash' },
        },
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
