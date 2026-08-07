"""ARCHITECTURE.md §9/§10b -- testable-implications cross-check.

`packages/graph/src/testable-implications.ts` finds, for every non-adjacent
pair of *observed* nodes, one minimal separating set among the other
observed nodes (or omits the pair if none exists -- e.g. connected only
through an unobserved confounder). This mirrors that independently in
networkx via `find_minimal_d_separator(G, x, y, restricted=observed)`, the
same "restrict the separator to nodes you could actually condition on"
scoping our own TS function uses.

Unlike TS's brute-force smallest-first search, networkx's algorithm can
return a *different* (but equally valid) minimal separator when several
exist -- so the TS-side validator (`validateTestableImplications` in
packages/validation/src/index.ts) does not compare sets for exact equality.
It checks existence agreement, and separately re-validates whichever set
this script found using the TS implementation's own `dSeparated` -- the
actual cross-library check, robust to either side picking a different
same-size minimal separator.

Purely structural, like generate_dsep_fixture.py: no sampling, no seed, no N
-- testable implications are a property of the graph, not the data. Reuses
the same four models as that script for consistency.

Run: uv run python scripts/generate_testable_implications_fixture.py
"""

import itertools
import json
from pathlib import Path

import networkx as nx

MODELS = {
    "confounding.scm": {
        "edges": [("C", "X"), ("X", "Y"), ("C", "Y")],
        "observed": ["C", "X", "Y"],
    },
    "collider.scm": {
        "edges": [("X", "S"), ("Y", "S")],
        "observed": ["X", "Y", "S"],
    },
    "mediator.scm": {
        "edges": [("X", "M"), ("M", "Y")],
        "observed": ["X", "M", "Y"],
    },
    "m-bias (inline, packages/graph/src/backdoor.test.ts)": {
        # latent U1 ~ Normal(0,1); latent U2 ~ Normal(0,1);
        # X = U1 + eps; Y = X + U2 + eps; M = U1 + U2 + eps
        "edges": [("U1", "X"), ("X", "Y"), ("U1", "M"), ("U2", "Y"), ("U2", "M")],
        "observed": ["X", "Y", "M"],  # U1, U2 latent -- excluded from the separator search
    },
}


def main() -> None:
    models_out = []
    for model_name, spec in MODELS.items():
        g = nx.DiGraph()
        g.add_nodes_from(spec["observed"])
        g.add_edges_from(spec["edges"])
        observed = spec["observed"]

        pairs = []
        for x, y in itertools.combinations(sorted(observed), 2):
            if g.has_edge(x, y) or g.has_edge(y, x):
                continue  # adjacent -- no CI statement
            separator = nx.find_minimal_d_separator(g, x, y, restricted=set(observed))
            pairs.append({"x": x, "y": y, "separator": sorted(separator) if separator is not None else None})

        models_out.append({"model": model_name, "edges": [list(e) for e in spec["edges"]], "observed": observed, "pairs": pairs})

    fixture = {
        "problem": "testable implications (minimal d-separating sets among observed non-adjacent pairs)",
        "dgp": "purely structural (graph topology only, no sampling)",
        "models": models_out,
        "references": {"networkx": nx.__version__},
    }

    out_path = Path(__file__).parent.parent / "fixtures" / "testable-implications.json"
    out_path.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {out_path}")
    print(json.dumps(fixture, indent=2))


if __name__ == "__main__":
    main()
