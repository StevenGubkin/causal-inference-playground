// ARCHITECTURE.md §12: the permalink codec. Encodes/decodes
// { schemaVersion, model, query, seed } to a compact URL-safe string
// (JSON -> LZ-string -> URL component).
//
// Security note: permalinks let untrusted text reach any visitor's browser
// (ARCHITECTURE.md §14), but the "arbitrary code execution via the model"
// door is already closed elsewhere -- parseModel()'s security allow-list
// (math-instance.ts's findDisallowedNode) rejects any expression outside a
// fixed node-type/function allow-list, and this codec calls that exact
// same parseModel, no bypass. What a permalink *does* add is a resource-
// exhaustion surface: LZ-string compression can make a short URL expand
// into a large payload before parsing even starts (a "zip-bomb" shape),
// so every check below is ordered cheapest-and-safest first, and nothing
// past a size cap ever touches JSON.parse or the DSL parser.
import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';
import type { DslError } from 'scm-dsl';
import { parseModel, parseStatements } from 'scm-dsl';
import { migrations, SCHEMA_VERSION } from './schema.js';
import type { PermalinkPayload, PermalinkQuery } from './schema.js';

export const MAX_ENCODED_LENGTH = 8_000;
export const MAX_DECOMPRESSED_BYTES = 200_000;
export const MAX_STATEMENTS = 500;

export type DecodeError =
  | { kind: 'too-large' }
  | { kind: 'decompression-failed' }
  | { kind: 'too-large-decompressed' }
  | { kind: 'malformed-json' }
  | { kind: 'invalid-shape'; detail: string }
  | { kind: 'incompatible-version'; schemaVersion: number }
  | { kind: 'too-many-statements'; count: number }
  | { kind: 'invalid-model'; errors: DslError[] };

export type DecodeResult = { ok: true; payload: PermalinkPayload } | { ok: false; error: DecodeError };

export function encodePermalink(payload: Omit<PermalinkPayload, 'schemaVersion'>): string {
  const full: PermalinkPayload = { schemaVersion: SCHEMA_VERSION, ...payload };
  return compressToEncodedURIComponent(JSON.stringify(full));
}

const ESTIMAND_VALUES = new Set(['doseResponse', 'ate']);
const BASIS_MODE_VALUES = new Set(['polynomial', 'kernelRidge']);

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Full field-by-field shape/type check -- every PermalinkQuery field
 * checked by exact type, estimand/basisMode checked against their literal
 * sets (not just `typeof === 'string'`), so a malformed or hand-crafted
 * payload can't reach app state with a field of the wrong shape. */
function validateShape(raw: unknown): { ok: true; payload: PermalinkPayload } | { ok: false; detail: string } {
  if (typeof raw !== 'object' || raw === null) return { ok: false, detail: 'payload is not an object' };
  const p = raw as Record<string, unknown>;

  if (typeof p.schemaVersion !== 'number') return { ok: false, detail: 'schemaVersion missing or not a number' };
  if (typeof p.model !== 'string') return { ok: false, detail: 'model missing or not a string' };
  if (typeof p.seed !== 'number' || !Number.isFinite(p.seed)) return { ok: false, detail: 'seed missing or not a finite number' };
  if (typeof p.query !== 'object' || p.query === null) return { ok: false, detail: 'query missing or not an object' };

  const q = p.query as Record<string, unknown>;
  if (typeof q.treatment !== 'string') return { ok: false, detail: 'query.treatment is not a string' };
  if (typeof q.outcome !== 'string') return { ok: false, detail: 'query.outcome is not a string' };
  if (!Array.isArray(q.adjustmentSet) || !q.adjustmentSet.every((x) => typeof x === 'string')) {
    return { ok: false, detail: 'query.adjustmentSet is not a string array' };
  }
  if (typeof q.instrument !== 'string') return { ok: false, detail: 'query.instrument is not a string' };
  if (typeof q.mediator !== 'string') return { ok: false, detail: 'query.mediator is not a string' };
  if (typeof q.estimand !== 'string' || !ESTIMAND_VALUES.has(q.estimand)) return { ok: false, detail: 'query.estimand is not a recognized value' };
  if (!isFiniteNumber(q.ateA)) return { ok: false, detail: 'query.ateA is not a finite number' };
  if (!isFiniteNumber(q.ateB)) return { ok: false, detail: 'query.ateB is not a finite number' };
  if (!isFiniteNumber(q.degree)) return { ok: false, detail: 'query.degree is not a finite number' };
  if (typeof q.basisMode !== 'string' || !BASIS_MODE_VALUES.has(q.basisMode)) return { ok: false, detail: 'query.basisMode is not a recognized value' };
  if (!isFiniteNumber(q.bandwidth)) return { ok: false, detail: 'query.bandwidth is not a finite number' };
  if (!isFiniteNumber(q.lambda)) return { ok: false, detail: 'query.lambda is not a finite number' };
  if (!isFiniteNumber(q.noiseSD)) return { ok: false, detail: 'query.noiseSD is not a finite number' };

  return {
    ok: true,
    payload: {
      schemaVersion: p.schemaVersion,
      model: p.model,
      seed: p.seed,
      query: q as unknown as PermalinkQuery,
    },
  };
}

export function decodePermalink(encoded: string): DecodeResult {
  if (encoded.length > MAX_ENCODED_LENGTH) return { ok: false, error: { kind: 'too-large' } };

  // lz-string's own .d.ts claims this always returns a string, but it
  // returns runtime null on malformed/corrupted input -- and JSON.parse(null)
  // does NOT throw (it stringifies its argument first, so JSON.parse(null)
  // succeeds and evaluates to the value null). Skipping this explicit check
  // turns a bad link into an uncaught TypeError a few lines down instead of
  // a clean decode error.
  const decompressed = decompressFromEncodedURIComponent(encoded) as string | null;
  if (decompressed === null || decompressed === '') return { ok: false, error: { kind: 'decompression-failed' } };
  if (decompressed.length > MAX_DECOMPRESSED_BYTES) return { ok: false, error: { kind: 'too-large-decompressed' } };

  let raw: unknown;
  try {
    raw = JSON.parse(decompressed);
  } catch {
    return { ok: false, error: { kind: 'malformed-json' } };
  }
  if (typeof raw !== 'object' || raw === null) return { ok: false, error: { kind: 'invalid-shape', detail: 'payload is not an object' } };

  const versioned = raw as { schemaVersion?: unknown };
  if (typeof versioned.schemaVersion !== 'number') {
    return { ok: false, error: { kind: 'invalid-shape', detail: 'schemaVersion missing or not a number' } };
  }
  const schemaVersion = versioned.schemaVersion;
  let migrated: unknown = raw;
  if (schemaVersion !== SCHEMA_VERSION) {
    const migration = migrations[schemaVersion];
    if (!migration) return { ok: false, error: { kind: 'incompatible-version', schemaVersion } };
    migrated = migration(raw);
  }

  const shape = validateShape(migrated);
  if (!shape.ok) return { ok: false, error: { kind: 'invalid-shape', detail: shape.detail } };

  const statementCount = parseStatements(shape.payload.model).statements.length;
  if (statementCount > MAX_STATEMENTS) return { ok: false, error: { kind: 'too-many-statements', count: statementCount } };

  // The security boundary: reuse the exact same parser/validator every
  // other model source (Freeform typing, example presets) already goes
  // through. A permalink gets no special trust.
  const parsed = parseModel(shape.payload.model);
  if (!parsed.ok) return { ok: false, error: { kind: 'invalid-model', errors: parsed.errors } };

  return { ok: true, payload: shape.payload };
}

export function describePermalinkError(error: DecodeError): string {
  switch (error.kind) {
    case 'too-large':
      return 'This link is too long to be a valid permalink.';
    case 'decompression-failed':
      return 'This link could not be read -- it may be corrupted or truncated.';
    case 'too-large-decompressed':
      return 'This link decodes to more data than a permalink should ever contain.';
    case 'malformed-json':
      return 'This link\'s data is not in a format this app recognizes.';
    case 'invalid-shape':
      return `This link's data is missing or malformed (${error.detail}).`;
    case 'incompatible-version':
      return `This link was created with an incompatible version (schema v${error.schemaVersion}) and can't be opened here.`;
    case 'too-many-statements':
      return `This link's model is too large (${error.count} statements, max ${MAX_STATEMENTS}).`;
    case 'invalid-model':
      return `This link's model failed to parse: ${error.errors.map((e) => e.message).join('; ')}`;
  }
}
