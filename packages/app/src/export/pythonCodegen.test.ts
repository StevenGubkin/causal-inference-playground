import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseModel } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { modelToPython } from './pythonCodegen.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadSource(name: string): string {
  return readFileSync(join(__dirname, '../../../examples/models', name), 'utf8');
}

describe('modelToPython', () => {
  it('generates a naive + g-computation section for confounding.scm', () => {
    const source = loadSource('confounding.scm');
    const parsed = parseModel(source);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    const script = modelToPython({
      source,
      model: parsed.model,
      treatment: 'X',
      outcome: 'Y',
      adjustmentSet: new Set(['C']),
      instrument: null,
      mediator: null,
      basisMode: 'polynomial',
      degree: 1,
      bandwidth: 1,
      lambda: 0.1,
      seed: 1,
      noiseSD: 1,
      sampleSize: 500,
    });

    expect(script).toContain('import numpy as np');
    expect(script).toContain('import statsmodels.api as sm');
    expect(script).toContain('SEED = 1');
    expect(script).toContain('N = 500');
    // dependency order: C has no parents, so it must be sampled before X,
    // which must be sampled before Y (X appears in Y's expression). Search
    // for a leading newline so this doesn't match the embedded source
    // comment in the header ("# X = 1.5*C + eps"), which appears earlier.
    const cLine = script.indexOf('\nC = rng.normal(0, 1, size=N)');
    const xLine = script.indexOf('\nX = ');
    const yLine = script.indexOf('\nY = (');
    expect(cLine).toBeGreaterThan(-1);
    expect(cLine).toBeLessThan(xLine);
    expect(xLine).toBeLessThan(yLine);
    expect(script).toContain('naive_fit = sm.OLS');
    expect(script).toContain('g-computation, adjusting for {C}');
    expect(script).not.toContain('IV / 2SLS');
    expect(script).not.toContain('front-door');
  });

  it('includes an IV/2SLS section when an instrument is set', () => {
    const source = loadSource('iv-late.scm');
    const parsed = parseModel(source);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    const script = modelToPython({
      source,
      model: parsed.model,
      treatment: 'D',
      outcome: 'Y',
      adjustmentSet: new Set(),
      instrument: 'Z',
      mediator: null,
      basisMode: 'polynomial',
      degree: 1,
      bandwidth: 1,
      lambda: 0.1,
      seed: 2,
      noiseSD: 1,
      sampleSize: 500,
    });

    expect(script).toContain('IV / 2SLS via Z');
    expect(script).toContain('iv_stage1 = sm.OLS(data["D"], sm.add_constant(data["Z"]))');
    // D0/D1/D1extra/U are latent -- must not appear in the observed data frame.
    expect(script).toMatch(/data = pd\.DataFrame\(\{"Z": Z, "D": D, "Y": Y\}\)/);
  });

  it('includes a front-door section when a mediator is set', () => {
    const source = loadSource('frontdoor.scm');
    const parsed = parseModel(source);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    const script = modelToPython({
      source,
      model: parsed.model,
      treatment: 'X',
      outcome: 'Y',
      adjustmentSet: new Set(),
      instrument: null,
      mediator: 'M',
      basisMode: 'polynomial',
      degree: 1,
      bandwidth: 1,
      lambda: 0.1,
      seed: 3,
      noiseSD: 1,
      sampleSize: 500,
    });

    expect(script).toContain('front-door via M');
    expect(script).toContain('fd_stage1 = sm.OLS(data["M"], sm.add_constant(data["X"]))');
  });

  it('reproduces the kernel-ridge basis via sklearn, parameterized to match kernelRidge.ts', () => {
    const source = loadSource('confounding.scm');
    const parsed = parseModel(source);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    const script = modelToPython({
      source,
      model: parsed.model,
      treatment: 'X',
      outcome: 'Y',
      adjustmentSet: new Set(['C']),
      instrument: null,
      mediator: null,
      basisMode: 'kernelRidge',
      degree: 1,
      bandwidth: 2,
      lambda: 0.25,
      seed: 1,
      noiseSD: 1,
      sampleSize: 500,
    });

    expect(script).toContain('from sklearn.kernel_ridge import KernelRidge');
    expect(script).toContain('BANDWIDTH = 2');
    expect(script).toContain('LAMBDA = 0.25');
    // gamma = 1/(2*bandwidth^2) is the exact RBF parameterization match to
    // kernelRidge.ts's exp(-||a-b||^2 / (2*bandwidth^2)); alpha=lam matches
    // its (K + lambda*I) ridge regularization.
    expect(script).toContain('gamma=1 / (2 * bandwidth**2)');
    expect(script).toContain('model = KernelRidge(alpha=lam, kernel="rbf"');
    expect(script).toContain('naive_curve = _kernel_ridge_gcomp(data["X"].values, [], data["Y"].values, BANDWIDTH, LAMBDA, kr_grid)');
    expect(script).toContain('gcomp_curve = _kernel_ridge_gcomp(data["X"].values, [data["C"].values], data["Y"].values, BANDWIDTH, LAMBDA, kr_grid)');
    expect(script).not.toContain('sm.OLS(data["Y"], sm.add_constant(data["X"]))'); // no plain-OLS naive when kernel ridge is active
  });

  it('omits sklearn entirely in polynomial mode', () => {
    const source = loadSource('confounding.scm');
    const parsed = parseModel(source);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.errors));

    const script = modelToPython({
      source,
      model: parsed.model,
      treatment: 'X',
      outcome: 'Y',
      adjustmentSet: new Set(['C']),
      instrument: null,
      mediator: null,
      basisMode: 'polynomial',
      degree: 1,
      bandwidth: 1,
      lambda: 0.1,
      seed: 1,
      noiseSD: 1,
      sampleSize: 500,
    });

    expect(script).not.toContain('sklearn');
  });
});
