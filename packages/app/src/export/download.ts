// ARCHITECTURE.md §12 "Export": the one bit of browser-only glue shared by
// every export button (model .scm, sample CSV, DAG SVG, generated Python) --
// everything else in export/ is a pure string-producing function, testable
// without a DOM.
export function downloadFile(filename: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
