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
import { fitMultivariateOLS, frontdoorDoseResponse, gcompDoseResponse, iv2sls } from 'estimators';
import { backdoorValid, findBackdoorSet, frontdoorValid } from 'graph';
import { parseModel } from 'scm-dsl';
import type { Model } from 'scm-dsl';
import { createRNG, forwardSample } from 'scm-engine';

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

console.log(`Validating against fixtures in ${FIXTURES_DIR} (n=${N})`);
validateBackdoor();
validateNaive();
validateIv();
validateFrontdoor();
validateDsep();

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
if (failures > 0) process.exit(1);
