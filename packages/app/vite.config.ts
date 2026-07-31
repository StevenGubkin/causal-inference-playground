import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Resolve workspace packages straight to their TS source rather than
// node_modules/<pkg>/dist, so `npm run dev` never depends on a prior
// `tsc -b` having built those packages first.
function src(pkg: string): string {
  return fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      'scm-dsl': src('scm-dsl'),
      graph: src('graph'),
      'scm-engine': src('scm-engine'),
      estimators: src('estimators'),
      share: src('share'),
    },
  },
  server: {
    port: 5173,
  },
});
