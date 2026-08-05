# Expected-answer fixtures

Was meant to hold precomputed expected outputs for `../models/*.scm`, used by
the golden tests in ARCHITECTURE.md §10a. In practice, every golden test
written so far (`packages/estimators/src/*.test.ts`,
`packages/graph/src/*.test.ts`) parses the `.scm` source directly, samples it
at a fixed seed, and asserts against a documented literature/oracle-derived
number inline via `toBeCloseTo` — never a separate JSON file here. This
directory has stayed empty since Phase 0/1 as a result and isn't read by any
code (`packages/validation/fixtures/` is the actual committed-fixture
directory in active use, for the separate cross-library validation in
ARCHITECTURE.md §10b). Left in place in case a future golden test wants a
shared fixture rather than an inline literal; do not hand-write numbers here
if it does — they must come from running the actual oracle/estimators
against a fixed seed.
