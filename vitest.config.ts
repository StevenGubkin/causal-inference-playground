import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Resolve workspace packages straight to their TS source rather than
// node_modules/<pkg>/dist — otherwise every cross-package import silently
// depends on a `tsc -b` having already run, which is easy to forget mid-edit.
function src(pkg: string): string {
  return fileURLToPath(new URL(`./packages/${pkg}/src/index.ts`, import.meta.url));
}

export default defineConfig({
  resolve: {
    alias: {
      'scm-dsl': src('scm-dsl'),
      graph: src('graph'),
      'scm-engine': src('scm-engine'),
      estimators: src('estimators'),
      share: src('share'),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts'],
  },
});
