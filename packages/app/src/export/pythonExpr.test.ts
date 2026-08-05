import { parseStatements } from 'scm-dsl';
import { describe, expect, it } from 'vitest';
import { pyExpr, usesNoiseSymbol } from './pythonExpr.js';

function toPython(source: string, noiseVar = '_eps'): string {
  const { statements, errors } = parseStatements(`Y = ${source}`);
  if (errors.length > 0) throw new Error(JSON.stringify(errors));
  const stmt = statements[0]!;
  if (stmt.kind !== 'node' || stmt.form !== 'deterministic') throw new Error('expected a deterministic node');
  return pyExpr(stmt.expr.node, noiseVar);
}

describe('pyExpr', () => {
  it('renders arithmetic with explicit parens and ** for power', () => {
    expect(toPython('2*X + 3')).toBe('((2 * X) + 3)');
    expect(toPython('X^2')).toBe('(X ** 2)');
    expect(toPython('-X')).toBe('(-X)');
    expect(toPython('(X + 1) / 2')).toBe('((X + 1) / 2)');
  });

  it('maps DSL functions to numpy equivalents', () => {
    expect(toPython('cos(X)')).toBe('np.cos(X)');
    expect(toPython('exp(X)')).toBe('np.exp(X)');
    expect(toPython('min(X, 1)')).toBe('np.minimum(X, 1)');
    expect(toPython('clamp(X, 0, 1)')).toBe('np.clip(X, 0, 1)');
  });

  it('maps logistic/sigmoid and step/indicator to the same shared helper', () => {
    expect(toPython('logistic(X)')).toBe('_logistic(X)');
    expect(toPython('sigmoid(X)')).toBe('_logistic(X)');
    expect(toPython('step(X)')).toBe('_step(X)');
    expect(toPython('indicator(X)')).toBe('_step(X)');
  });

  it('substitutes the noise variable for every eps spelling', () => {
    expect(toPython('X + eps', '_eps_Y')).toBe('(X + _eps_Y)');
    expect(toPython('X + epsilon', '_eps_Y')).toBe('(X + _eps_Y)');
  });
});

describe('usesNoiseSymbol', () => {
  it('detects eps anywhere in the expression tree', () => {
    const { statements, errors } = parseStatements('Y = cos(X) + 2*eps');
    if (errors.length > 0) throw new Error(JSON.stringify(errors));
    const stmt = statements[0]!;
    if (stmt.kind !== 'node' || stmt.form !== 'deterministic') throw new Error('expected deterministic');
    expect(usesNoiseSymbol(stmt.expr.node)).toBe(true);
  });

  it('is false when the expression is noise-free', () => {
    const { statements, errors } = parseStatements('Y = cos(X) + 2');
    if (errors.length > 0) throw new Error(JSON.stringify(errors));
    const stmt = statements[0]!;
    if (stmt.kind !== 'node' || stmt.form !== 'deterministic') throw new Error('expected deterministic');
    expect(usesNoiseSymbol(stmt.expr.node)).toBe(false);
  });
});
