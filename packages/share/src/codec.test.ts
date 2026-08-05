import { compressToEncodedURIComponent } from 'lz-string';
import { describe, expect, it } from 'vitest';
import { decodePermalink, encodePermalink, MAX_ENCODED_LENGTH, MAX_STATEMENTS } from './codec.js';
import type { PermalinkPayload } from './schema.js';
import { SCHEMA_VERSION } from './schema.js';

const validQuery: PermalinkPayload['query'] = {
  treatment: 'X',
  outcome: 'Y',
  adjustmentSet: ['C'],
  instrument: '',
  mediator: '',
  estimand: 'doseResponse',
  ateA: 0,
  ateB: 1,
  degree: 2,
  basisMode: 'polynomial',
  bandwidth: 1,
  lambda: 0.1,
  noiseSD: 1,
};

const validModel = 'C ~ Normal(0, 1)\nX = 1.5*C + eps\nY = 2*X + 3*C + eps';

describe('encodePermalink / decodePermalink round-trip', () => {
  it('decodes exactly what was encoded, with schemaVersion attached', () => {
    const encoded = encodePermalink({ model: validModel, query: validQuery, seed: 42 });
    const result = decodePermalink(encoded);
    expect(result).toEqual({
      ok: true,
      payload: { schemaVersion: SCHEMA_VERSION, model: validModel, query: validQuery, seed: 42 },
    });
  });
});

describe('decodePermalink: resource-exhaustion defenses', () => {
  it('rejects an over-long encoded string before attempting decompression', () => {
    const result = decodePermalink('x'.repeat(MAX_ENCODED_LENGTH + 1));
    expect(result).toEqual({ ok: false, error: { kind: 'too-large' } });
  });

  it('rejects a decompressed payload larger than the byte cap, before JSON.parse', () => {
    // Highly repetitive content compresses to well under MAX_ENCODED_LENGTH
    // even though the decompressed JSON is far over MAX_DECOMPRESSED_BYTES.
    const hugeJson = `{"padding":"${'a'.repeat(250_000)}"}`;
    const encoded = compressToEncodedURIComponent(hugeJson);
    expect(encoded.length).toBeLessThan(MAX_ENCODED_LENGTH);
    const result = decodePermalink(encoded);
    expect(result).toEqual({ ok: false, error: { kind: 'too-large-decompressed' } });
  });

  it('rejects a model with more statements than the cap allows', () => {
    const lines = Array.from({ length: MAX_STATEMENTS }, (_, i) => `N${i} = ${i}`);
    lines.push(`N${MAX_STATEMENTS} = N0 + 1`); // MAX_STATEMENTS + 1 total, with a real causal edge
    const payload = { model: lines.join('\n'), query: validQuery, seed: 1 };
    const encoded = encodePermalink(payload);
    const result = decodePermalink(encoded);
    expect(result).toEqual({ ok: false, error: { kind: 'too-many-statements', count: MAX_STATEMENTS + 1 } });
  });
});

describe('decodePermalink: malformed/corrupted input', () => {
  it('does not throw on garbage input, and reports decompression-failed', () => {
    // Regression test: lz-string's decompressFromEncodedURIComponent returns
    // runtime null on malformed input despite its .d.ts claiming it always
    // returns a string -- and JSON.parse(null) does NOT throw (it stringifies
    // its argument first, so JSON.parse(null) succeeds and evaluates to
    // null). Without an explicit null check, this input would throw an
    // uncaught TypeError a few lines later instead of decoding cleanly to
    // an error result. Easy to silently reintroduce in a refactor.
    expect(() => decodePermalink('garbage')).not.toThrow();
    expect(decodePermalink('garbage')).toEqual({ ok: false, error: { kind: 'decompression-failed' } });
    expect(decodePermalink('!!!not-valid!!!')).toEqual({ ok: false, error: { kind: 'decompression-failed' } });
  });

  it('rejects a validly-compressed string that is not JSON', () => {
    const encoded = compressToEncodedURIComponent('not json{');
    expect(decodePermalink(encoded)).toEqual({ ok: false, error: { kind: 'malformed-json' } });
  });
});

describe('decodePermalink: shape validation', () => {
  function encodeRaw(obj: unknown): string {
    return compressToEncodedURIComponent(JSON.stringify(obj));
  }

  it('rejects a payload missing schemaVersion', () => {
    const encoded = encodeRaw({ model: validModel, query: validQuery, seed: 1 });
    const result = decodePermalink(encoded);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('invalid-shape');
  });

  it('rejects a non-numeric degree', () => {
    const encoded = encodeRaw({
      schemaVersion: SCHEMA_VERSION,
      model: validModel,
      query: { ...validQuery, degree: 'lots' },
      seed: 1,
    });
    const result = decodePermalink(encoded);
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-shape', detail: 'query.degree is not a finite number' } });
  });

  it('rejects an unrecognized estimand value', () => {
    const encoded = encodeRaw({
      schemaVersion: SCHEMA_VERSION,
      model: validModel,
      query: { ...validQuery, estimand: 'bogus' },
      seed: 1,
    });
    const result = decodePermalink(encoded);
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-shape', detail: 'query.estimand is not a recognized value' } });
  });

  it('rejects a non-array adjustmentSet', () => {
    const encoded = encodeRaw({
      schemaVersion: SCHEMA_VERSION,
      model: validModel,
      query: { ...validQuery, adjustmentSet: 'C' },
      seed: 1,
    });
    const result = decodePermalink(encoded);
    expect(result).toEqual({ ok: false, error: { kind: 'invalid-shape', detail: 'query.adjustmentSet is not a string array' } });
  });
});

describe('decodePermalink: schema versioning', () => {
  it('rejects a schemaVersion with no migration path (the empty-chain-fails-closed case)', () => {
    const encoded = compressToEncodedURIComponent(JSON.stringify({ schemaVersion: 0, model: validModel, query: validQuery, seed: 1 }));
    const result = decodePermalink(encoded);
    expect(result).toEqual({ ok: false, error: { kind: 'incompatible-version', schemaVersion: 0 } });
  });

  it('rejects an unknown future schemaVersion the same way', () => {
    const encoded = compressToEncodedURIComponent(JSON.stringify({ schemaVersion: 999, model: validModel, query: validQuery, seed: 1 }));
    const result = decodePermalink(encoded);
    expect(result).toEqual({ ok: false, error: { kind: 'incompatible-version', schemaVersion: 999 } });
  });
});

describe('decodePermalink: reuses the DSL security allow-list', () => {
  it('rejects a well-formed payload whose model fails parseModel (unresolved identifier)', () => {
    const encoded = encodePermalink({ model: 'Y = someUndeclaredName + 1', query: validQuery, seed: 1 });
    const result = decodePermalink(encoded);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe('invalid-model');
      if (result.error.kind === 'invalid-model') expect(result.error.errors.length).toBeGreaterThan(0);
    }
  });
});
