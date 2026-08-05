// ARCHITECTURE.md §12: serialize { schemaVersion, model, query, seed } to a
// compact URL hash and back, with a migration chain for old schemaVersions
// (the noise-budget/versioning INVARIANT added during design review).
export { decodePermalink, describePermalinkError, encodePermalink, MAX_DECOMPRESSED_BYTES, MAX_ENCODED_LENGTH, MAX_STATEMENTS } from './codec.js';
export type { DecodeError, DecodeResult } from './codec.js';
export { migrations, SCHEMA_VERSION } from './schema.js';
export type { Migration, PermalinkPayload, PermalinkQuery } from './schema.js';
