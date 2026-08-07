// ARCHITECTURE.md §10b: for each canonical problem, assert our own
// estimators land within Monte-Carlo tolerance of the committed fixtures
// (packages/validation/fixtures/*.json, generated out-of-band by the
// Python scripts in scripts/ -- see packages/validation/scripts/README.md
// to regenerate). This runs in CI without a Python runtime since the
// fixtures are just committed JSON.
//
// Tolerances are generous relative to what the reference libraries'
// own confidence intervals show (e.g. the backdoor fixture's DoWhy CI is
// ~[1.985, 2.026], width ~0.04): our engine uses a different seeded RNG
// (mulberry32) than numpy's default generator, so the two implementations
// never sample the same rows -- only the same *population* quantities, up
// to independent Monte Carlo error from each side. A tolerance this loose
// would not hide a real implementation bug (those show up as errors of
// several tenths or more, not hundredths).
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { aipwAte, fitMultivariateOLS, frontdoorDoseResponse, gcompDoseResponse, ipwAte, iv2sls } from 'estimators';
import { backdoorValid, dSeparated, findBackdoorSet, frontdoorValid, testableImplications } from 'graph';
import { parseModel } from 'scm-dsl';
import type { Model } from 'scm-dsl';
import { createRNG, forwardSample } from 'scm-engine';
import type { ObservedSample } from 'scm-engine';

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES_DIR = join(__dirname, '../../examples/models');
const FIXTURES_DIR = join(__dirname, '../fixtures');
const TOLERANCE = 0.15;
const N = 20000;

let failures = 0;

function loadFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES_DIR, name), 'utf8')) as T;
}

function loadModelSource(name: string): string {
  return readFileSync(join(EXAMPLES_DIR, name), 'utf8');
}

function check(label: string, actual: number, expected: number, tolerance = TOLERANCE): void {
  const diff = Math.abs(actual - expected);
  const ok = diff <= tolerance;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}: got ${actual.toFixed(4)}, expected ${expected.toFixed(4)} (±${tolerance}, diff ${diff.toFixed(4)})`);
}

// Graph-structural checks (d-separation/backdoor sets) are exact booleans
// and set membership, not Monte-Carlo numbers -- no tolerance applies.
function checkBool(label: string, actual: boolean, expected: boolean): void {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? '✓' : '✗'} ${label}: got ${actual}, expected ${expected}`);
}

function checkSet(label: string, actual: string[] | null, expected: string[] | null): void {
  const normalize = (s: string[] | null) => (s === null ? null : [...s].sort().join(','));
  const ok = normalize(actual) === normalize(expected);
  if (!ok) failures++;
  const fmt = (s: string[] | null) => (s === null ? 'null' : `{${s.join(', ')}}`);
  console.log(`${ok ? '✓' : '✗'} ${label}: got ${fmt(actual)}, expected ${fmt(expected)}`);
}

interface BackdoorFixture {
  backdoor_adjusted_ols_slope: number;
  dowhy_backdoor_estimate: number;
}

interface IvFixture {
  iv2sls_estimate: number;
  first_stage_f: number;
}

function validateBackdoor(): void {
  console.log('\n--- backdoor ATE (confounding.scm) vs. DoWhy/statsmodels ---');
  const fixture = loadFixture<BackdoorFixture>('backdoor-confounding.json');

  const parsed = parseModel(loadModelSource('confounding.scm'));
  if (!parsed.ok) throw new Error(`confounding.scm failed to parse: ${JSON.stringify(parsed.errors)}`);

  const sample = forwardSample(parsed.model, N, createRNG(1));
  const observed = sample.observed();

  const gcompCurve = gcompDoseResponse(observed, 'X', 'Y', ['C'], [0, 1]);
  const gcompSlope = gcompCurve.ys[1]! - gcompCurve.ys[0]!;

  check('g-comp{C} vs. statsmodels backdoor-adjusted OLS', gcompSlope, fixture.backdoor_adjusted_ols_slope);
  check('g-comp{C} vs. DoWhy backdoor.linear_regression', gcompSlope, fixture.dowhy_backdoor_estimate);
}

function validateIv(): void {
  console.log('\n--- IV/2SLS (LATE) (iv-late.scm) vs. linearmodels ---');
  const fixture = loadFixture<IvFixture>('iv-late.json');

  const parsed = parseModel(loadModelSource('iv-late.scm'));
  if (!parsed.ok) throw new Error(`iv-late.scm failed to parse: ${JSON.stringify(parsed.errors)}`);

  const sample = forwardSample(parsed.model, N, createRNG(2));
  const observed = sample.observed();

  const iv = iv2sls(observed, 'D', 'Y', 'Z', [0, 1]);

  check('iv2sls estimate vs. linearmodels IV2SLS', iv.estimate, fixture.iv2sls_estimate);
  // First-stage F scales with n and differs in exact convention between
  // implementations (see the module comment); check it's unambiguously
  // strong (>10, the standard Staiger-Stock weak-instrument threshold)
  // rather than requiring numerical closeness to the fixture's value.
  const strongInstrument = iv.firstStageF > 10;
  console.log(`${strongInstrument ? '✓' : '✗'} first-stage F is strong (>10): got ${iv.firstStageF.toFixed(1)} (fixture: ${fixture.first_stage_f.toFixed(1)})`);
  if (!strongInstrument) failures++;
}

function validateNaive(): void {
  const fixture = loadFixture<{ naive_ols_slope: number }>('backdoor-confounding.json');
  const parsed = parseModel(loadModelSource('confounding.scm'));
  if (!parsed.ok) throw new Error(`confounding.scm failed to parse: ${JSON.stringify(parsed.errors)}`);
  const sample = forwardSample(parsed.model, N, createRNG(1));
  const observed = sample.observed();
  const fit = fitMultivariateOLS([observed.columns.get('X')!], observed.columns.get('Y')!);
  check('naive OLS vs. statsmodels naive OLS', fit.coefficients[0]!, fixture.naive_ols_slope);
}

interface FrontdoorFixture {
  frontdoor_estimate: number;
}

function validateFrontdoor(): void {
  console.log('\n--- front-door adjustment (frontdoor.scm) vs. statsmodels two-stage OLS ---');
  const fixture = loadFixture<FrontdoorFixture>('frontdoor-adjustment.json');

  const parsed = parseModel(loadModelSource('frontdoor.scm'));
  if (!parsed.ok) throw new Error(`frontdoor.scm failed to parse: ${JSON.stringify(parsed.errors)}`);

  const sample = forwardSample(parsed.model, N, createRNG(3));
  const observed = sample.observed();

  const frontdoor = frontdoorDoseResponse(observed, 'X', 'Y', 'M', [0, 1]);
  check('frontdoor estimate vs. statsmodels two-stage OLS', frontdoor.estimate, fixture.frontdoor_estimate);
  checkBool('frontdoorValid({M})', frontdoorValid(parsed.model, 'X', 'Y', new Set(['M'])).ok, true);
}

interface GcompNonlinearFixture {
  degree: number;
  grid: number[];
  gcomp_curve: number[];
  true_curve: number[];
}

function validateGcompNonlinear(): void {
  console.log('\n--- g-computation dose-response, flexible basis (nonlinear.scm) vs. statsmodels ---');
  const fixture = loadFixture<GcompNonlinearFixture>('gcomp-nonlinear.json');

  const parsed = parseModel(loadModelSource('nonlinear.scm'));
  if (!parsed.ok) throw new Error(`nonlinear.scm failed to parse: ${JSON.stringify(parsed.errors)}`);

  const sample = forwardSample(parsed.model, N, createRNG(4));
  const observed = sample.observed();

  const curve = gcompDoseResponse(observed, 'X', 'Y', ['C'], fixture.grid, fixture.degree);

  fixture.grid.forEach((x, i) => {
    check(`gcomp{C} deg=${fixture.degree} at x=${x} vs. statsmodels`, curve.ys[i]!, fixture.gcomp_curve[i]!);
  });
  fixture.grid.forEach((x, i) => {
    check(`gcomp{C} deg=${fixture.degree} at x=${x} vs. closed-form cos(x)`, curve.ys[i]!, fixture.true_curve[i]!);
  });
}

interface IpwAipwFixture {
  dowhy_ipw_estimate: number;
  econml_aipw_estimate: number;
}

function validateIpwAipw(): void {
  console.log('\n--- IPW / AIPW ATE (ipw-confounding.scm) vs. DoWhy/EconML ---');
  const fixture = loadFixture<IpwAipwFixture>('ipw-aipw-confounding.json');

  const parsed = parseModel(loadModelSource('ipw-confounding.scm'));
  if (!parsed.ok) throw new Error(`ipw-confounding.scm failed to parse: ${JSON.stringify(parsed.errors)}`);

  const sample = forwardSample(parsed.model, N, createRNG(5));
  const observed = sample.observed();

  const ipw = ipwAte(observed, 'X', 'Y', ['Z'], [0, 1]);
  const aipw = aipwAte(observed, 'X', 'Y', ['Z'], [0, 1]);

  check('ipwAte vs. DoWhy backdoor.propensity_score_weighting', ipw.estimate, fixture.dowhy_ipw_estimate);
  check('aipwAte vs. EconML LinearDRLearner', aipw.estimate, fixture.econml_aipw_estimate);
}

interface DsepFixture {
  cases: {
    model: string;
    treatment: string;
    outcome: string;
    adjustment_sets_checked: { z: string[]; valid: boolean }[];
    minimal_backdoor_set: string[] | null;
  }[];
}

// The M-bias case in the fixture isn't one of the committed .scm presets --
// it mirrors the inline DSL source in packages/graph/src/backdoor.test.ts,
// the one case where only moralization (not the cheap descendant-exclusion
// shortcut) catches the invalid set, so it's kept here verbatim rather than
// adding a new preset file just for this cross-check.
const M_BIAS_SOURCE = 'latent U1 ~ Normal(0, 1)\nlatent U2 ~ Normal(0, 1)\nX = U1 + eps\nY = X + U2 + eps\nM = U1 + U2 + eps';

function loadDsepModel(name: string): Model {
  const source = name.startsWith('m-bias') ? M_BIAS_SOURCE : loadModelSource(name);
  const parsed = parseModel(source);
  if (!parsed.ok) throw new Error(`${name} failed to parse: ${JSON.stringify(parsed.errors)}`);
  return parsed.model;
}

function validateDsep(): void {
  console.log('\n--- d-separation / backdoor-criterion adjustment sets vs. networkx ---');
  const fixture = loadFixture<DsepFixture>('dsep-adjustment-sets.json');

  for (const c of fixture.cases) {
    const model = loadDsepModel(c.model);
    for (const { z, valid } of c.adjustment_sets_checked) {
      checkBool(`${c.model}: backdoorValid({${z.join(', ')}})`, backdoorValid(model, c.treatment, c.outcome, new Set(z)).ok, valid);
    }
    checkSet(`${c.model}: findBackdoorSet`, findBackdoorSet(model, c.treatment, c.outcome), c.minimal_backdoor_set);
  }
}

interface TestableImplicationsFixture {
  models: {
    model: string;
    pairs: { x: string; y: string; separator: string[] | null }[];
  }[];
}

// Not exact-set equality: find_minimal_d_separator (Python) and our own
// brute-force smallest-first search (TS) can legitimately pick *different*
// minimal separators of the same size when several exist -- no algorithmic
// guarantee of tie-breaking parity across languages/implementations. Cross-
// validate the conclusion instead: does TS agree a separator exists at all
// (existence agreement), and does TS's own dSeparated consider Python's
// chosen separator valid (the actual cross-library check, robust to either
// side finding a different same-size minimal set).
function validateTestableImplications(): void {
  console.log('\n--- testable implications (minimal d-separating sets) vs. networkx ---');
  const fixture = loadFixture<TestableImplicationsFixture>('testable-implications.json');

  for (const m of fixture.models) {
    const model = loadDsepModel(m.model);
    const tsStatements = testableImplications(model);
    const tsHasPair = (x: string, y: string) => tsStatements.some((s) => (s.x === x && s.y === y) || (s.x === y && s.y === x));

    for (const { x, y, separator } of m.pairs) {
      checkBool(`${m.model}: testableImplications finds a separator for (${x}, ${y}) iff networkx does`, tsHasPair(x, y), separator !== null);
      if (separator !== null) {
        checkBool(`${m.model}: TS dSeparated(${x}, ${y} | {${separator.join(', ')}}) agrees with networkx's separator`, dSeparated(model, x, y, new Set(separator)), true);
      }
    }
  }
}

interface IhdpFixture {
  source_url: string;
  n: number;
  true_ate: number;
  statsmodels_adjusted_estimate: number;
  dowhy_ipw_estimate: number;
  econml_aipw_estimate: number;
}

const IHDP_COVARIATES = Array.from({ length: 25 }, (_, i) => `x${i + 1}`);
// Unlike the synthetic fixtures, TS and Python here run against the
// *identical* fixed 747 rows (no independent sampling on either side), so
// this doesn't need to absorb Monte Carlo noise -- just genuine finite-
// sample estimation error at n=747 with 25 covariates, recovering a
// specific real quantity rather than converging in a law-of-large-numbers
// sense. Observed directly when building this fixture: naive/adjusted
// estimates land within ~0.09 of the true ATE, well inside this margin.
const IHDP_TRUTH_TOLERANCE = 0.3;

/** No header row: treatment, y_factual, y_cfactual, mu0, mu1, x1..x25 --
 * verified directly against the real file when this fixture was built (not
 * assumed from documentation alone). Only the columns our estimators need
 * (treatment, y_factual, x1..x25) are kept. */
function parseIhdpCsv(csv: string): ObservedSample {
  const rows = csv
    .trim()
    .split('\n')
    .map((line) => line.split(',').map(Number));
  const n = rows.length;
  const columns = new Map<string, Float64Array>();
  const colIndex: Record<string, number> = { treatment: 0, y_factual: 1 };
  IHDP_COVARIATES.forEach((name, i) => (colIndex[name] = 5 + i));
  for (const [name, idx] of Object.entries(colIndex)) {
    const col = new Float64Array(n);
    for (let r = 0; r < n; r++) col[r] = rows[r]![idx]!;
    columns.set(name, col);
  }
  return { n, columns };
}

/** The one network-dependent check in this suite (see the IHDP validation
 * plan for why the dataset itself isn't committed -- unclear licensing on
 * the hosting repos, despite a decade of pervasive academic reuse). A
 * missing network shouldn't fail an otherwise-passing local
 * `npm run validate`, so this is a soft skip, not a hard failure, on fetch
 * errors specifically -- an actual value mismatch after a successful fetch
 * still counts as a real failure like every other check. */
async function validateIhdp(): Promise<void> {
  console.log('\n--- IHDP semi-synthetic benchmark (Hill 2011) vs. statsmodels/DoWhy/EconML ---');
  const fixture = loadFixture<IhdpFixture>('ihdp.json');

  let csv: string;
  try {
    const response = await fetch(fixture.source_url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    csv = await response.text();
  } catch (err) {
    console.log(`⚠ skipped (network unavailable): IHDP validation -- ${(err as Error).message}`);
    return;
  }

  const observed = parseIhdpCsv(csv);
  const points = [0, 1];

  const gcompCurve = gcompDoseResponse(observed, 'treatment', 'y_factual', IHDP_COVARIATES, points);
  const gcompEstimate = gcompCurve.ys[1]! - gcompCurve.ys[0]!;
  check('gcompDoseResponse vs. statsmodels adjusted OLS', gcompEstimate, fixture.statsmodels_adjusted_estimate);
  check('gcompDoseResponse vs. true ATE (mean mu1-mu0)', gcompEstimate, fixture.true_ate, IHDP_TRUTH_TOLERANCE);

  const ipw = ipwAte(observed, 'treatment', 'y_factual', IHDP_COVARIATES, points);
  check('ipwAte vs. DoWhy backdoor.propensity_score_weighting', ipw.estimate, fixture.dowhy_ipw_estimate);
  check('ipwAte vs. true ATE (mean mu1-mu0)', ipw.estimate, fixture.true_ate, IHDP_TRUTH_TOLERANCE);

  const aipw = aipwAte(observed, 'treatment', 'y_factual', IHDP_COVARIATES, points);
  // Not a check() -- EconML's LinearDRLearner cross-fits (default cv=2) and
  // ours doesn't, a genuine methodological difference at this real n=747,
  // 25-covariate scale, not implementation noise on the same algorithm:
  // observed directly when building this fixture, our own (non-cross-fit)
  // aipwAte lands *closer* to the true ATE (diff ~0.05) than EconML's own
  // cross-fit estimate does (diff ~0.33). Forcing numerical agreement
  // between two different algorithms wouldn't test anything meaningful;
  // the assertion that matters is the true-ATE check right below, which
  // aipwAte passes comfortably (well inside even the standard tolerance).
  console.log(`  (FYI, not asserted -- different algorithm) aipwAte: ${aipw.estimate.toFixed(4)} vs. EconML LinearDRLearner: ${fixture.econml_aipw_estimate.toFixed(4)}`);
  check('aipwAte vs. true ATE (mean mu1-mu0)', aipw.estimate, fixture.true_ate, IHDP_TRUTH_TOLERANCE);
}

console.log(`Validating against fixtures in ${FIXTURES_DIR} (n=${N})`);
validateBackdoor();
validateNaive();
validateIv();
validateFrontdoor();
validateGcompNonlinear();
validateIpwAipw();
validateDsep();
validateTestableImplications();
await validateIhdp();

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
if (failures > 0) process.exit(1);
