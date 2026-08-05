// ARCHITECTURE.md §11: "a MathLive <math-field> per equation (real math
// notation)". Converts each parsed DSL statement into LaTeX for display,
// via mathjs's own MathNode.toTex() for the expression parts -- no free-form
// LaTeX parsing anywhere, only mathjs's well-tested AST serializer, since
// this is one-directional (see MathField.tsx's doc comment for why).
import type { MathNode } from 'mathjs';
import type { StatementAst } from 'scm-dsl';

// mathjs's default SymbolNode rendering has two problems for this DSL's
// identifiers (`X <-> Y` desugars to `latent U_XY ~ Normal(0,1)`, per
// ARCHITECTURE.md §4.4, so underscored multi-char names are real, not
// hypothetical):
//   1. It doesn't treat "name_rest" as a subscript at all -- it emits a
//      literal escaped underscore ("U\_XY"), a visible underscore
//      character, not "U" with a subscript "XY".
//   2. Multi-char bare names ("D1extra") render undifferentiated from a
//      product of single-letter variables (no \mathrm wrapping), which is
//      the wrong math convention for a label/name vs. an implicit product.
// Fixing both means overriding SymbolNode rendering via toTex's `handler`
// option -- but doing that has a surprising side effect, verified
// empirically: mathjs's default multiplication rendering inserts a
// protective space before a bare symbol (`D0\cdot D1`) specifically when
// it's using its OWN default symbol rendering; once ANY custom handler
// intercepts SymbolNode, that protection silently disappears
// (`D0\cdot D1` -> `D0\cdotD1`), which is a real bug risk -- `\cdotD1` is
// not `\cdot` followed by `D1`, it's an attempt to parse a macro named
// `\cdotD1`. So every symbol this renders -- even a single bare letter --
// must be self-delimiting on its own (wrapped in `\mathrm{}` or a bare
// `{}` group), not just the multi-char/subscript ones.
const NOISE_NAMES = new Set(['eps', 'epsilon', 'ε']);

// Spelled-out Greek letter names -> their LaTeX macros, for parameter/
// variable identifiers (never for distribution names -- see distNameTex --
// so a Gamma-distribution declaration never collides with Γ, the already-
// standard symbol for Euler's Gamma *function*). Capitalized forms are
// limited to the 11 that are visually distinct from Latin letters; the rest
// (Alpha, Beta, Epsilon, Zeta, Eta, Iota, Kappa, Mu, Nu, Omicron, Rho, Tau,
// Chi) look identical to a Latin letter in every common math font, so
// converting them would be an invisible no-op. "epsilon" itself is handled
// separately above (the DSL's noise keyword, always \varepsilon regardless
// of position), not duplicated here.
const GREEK_LETTERS: Record<string, string> = {
  alpha: '\\alpha',
  beta: '\\beta',
  gamma: '\\gamma',
  delta: '\\delta',
  zeta: '\\zeta',
  eta: '\\eta',
  theta: '\\theta',
  iota: '\\iota',
  kappa: '\\kappa',
  lambda: '\\lambda',
  mu: '\\mu',
  nu: '\\nu',
  xi: '\\xi',
  pi: '\\pi',
  rho: '\\rho',
  sigma: '\\sigma',
  tau: '\\tau',
  upsilon: '\\upsilon',
  phi: '\\phi',
  chi: '\\chi',
  psi: '\\psi',
  omega: '\\omega',
  Gamma: '\\Gamma',
  Delta: '\\Delta',
  Theta: '\\Theta',
  Lambda: '\\Lambda',
  Xi: '\\Xi',
  Pi: '\\Pi',
  Sigma: '\\Sigma',
  Upsilon: '\\Upsilon',
  Phi: '\\Phi',
  Psi: '\\Psi',
  Omega: '\\Omega',
};

function texIdentifier(name: string): string {
  if (NOISE_NAMES.has(name)) return '\\varepsilon';

  const underscore = name.indexOf('_');
  const base = underscore === -1 ? name : name.slice(0, underscore);
  const sub = underscore === -1 ? '' : name.slice(underscore + 1);

  // A recognized Greek letter is already self-delimiting (starts with `\`,
  // so nothing preceding it can glue on -- see the toTexHandler comment
  // below for why that matters), unlike a bare Latin symbol.
  const baseTex = GREEK_LETTERS[base] ?? (base.length > 1 ? `\\mathrm{${base}}` : `{${base}}`);
  if (!sub) return baseTex;
  // Already inside `_{...}`, which is itself a self-delimiting group, so a
  // single-char (or Greek) subscript doesn't need its own extra {} the way
  // a bare top-level symbol does.
  const subTex = GREEK_LETTERS[sub] ?? (sub.length > 1 ? `\\mathrm{${sub}}` : sub);
  return `${baseTex}_{${subTex}}`;
}

// Distribution names are deliberately a separate code path from
// texIdentifier above -- run through the same Greek-letter table, "Gamma"
// and "Beta" (real distributions in this DSL) would either collide with
// the Gamma *function* symbol or silently no-op (capital Greek Beta is
// indistinguishable from Latin B). \mathcal{N} is the one near-universal
// distribution shorthand common enough to be worth a special case; the
// others (Gamma, Uniform, Exponential, ...) don't have an equally dominant
// single convention, so plain upright text is the honest default.
function distNameTex(name: string): string {
  return name === 'Normal' ? '\\mathcal{N}' : `\\mathrm{${name}}`;
}

function toTexHandler(node: MathNode): string | undefined {
  return node.type === 'SymbolNode' ? texIdentifier((node as unknown as { name: string }).name) : undefined;
}

function exprToTex(raw: { node: MathNode }): string {
  return raw.node.toTex({ handler: toTexHandler });
}

/** One LaTeX string per statement, in source order. */
export function statementToLatex(stmt: StatementAst): string {
  switch (stmt.kind) {
    case 'node': {
      const prefix = stmt.latent ? '\\text{latent }\\,' : '';
      const name = texIdentifier(stmt.name);
      if (stmt.form === 'deterministic') {
        return `${prefix}${name} = ${exprToTex(stmt.expr)}`;
      }
      const args = stmt.dist.args.map((a) => exprToTex(a)).join(',\\ ');
      return `${prefix}${name} \\sim ${distNameTex(stmt.dist.name)}\\left(${args}\\right)`;
    }
    case 'noise': {
      const args = stmt.dist.args.map((a) => exprToTex(a)).join(',\\ ');
      return `\\text{noise }\\,${texIdentifier(stmt.name)} \\sim ${distNameTex(stmt.dist.name)}\\left(${args}\\right)`;
    }
    case 'bidirected':
      return `${texIdentifier(stmt.a)} \\leftrightarrow ${texIdentifier(stmt.b)}`;
  }
}
