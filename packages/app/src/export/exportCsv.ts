// ARCHITECTURE.md §12 "Export": sample as CSV. Column names are always
// valid DSL identifiers ([A-Za-z][A-Za-z0-9_]*), so no header-escaping is
// needed; values are plain finite numbers, so no value-escaping either.
import type { ObservedSample } from 'scm-engine';

export function sampleToCsv(observed: ObservedSample): string {
  const columnNames = [...observed.columns.keys()];
  const columns = columnNames.map((name) => observed.columns.get(name)!);

  const lines = [columnNames.join(',')];
  for (let i = 0; i < observed.n; i++) {
    lines.push(columns.map((col) => col[i]).join(','));
  }
  return lines.join('\n') + '\n';
}
