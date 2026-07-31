// ARCHITECTURE.md §4.5 (grammar) — the line-parser's output, before static
// validation (§4.8) resolves identifiers and compiles the Model IR.
import type { MathNode } from 'mathjs';

export interface ExprSource {
  raw: string;
  node: MathNode;
}

export interface DistributionSource {
  name: string;
  args: ExprSource[];
}

export type StatementAst =
  | { kind: 'node'; line: number; name: string; latent: boolean; form: 'deterministic'; expr: ExprSource }
  | { kind: 'node'; line: number; name: string; latent: boolean; form: 'stochastic'; dist: DistributionSource }
  | { kind: 'noise'; line: number; name: string; dist: DistributionSource }
  | { kind: 'cov'; line: number; a: string; b: string; value: number }
  | { kind: 'bidirected'; line: number; a: string; b: string };
