"""ARCHITECTURE.md §9/§10b -- d-separation / backdoor-criterion cross-check.

ARCHITECTURE.md names dagitty (an R package) for this row of the validation
table. This uses networkx's d-separation primitive
(networkx.algorithms.d_separation.is_d_separator) instead of adding a second
language toolchain to the repo -- it implements the same moralization
algorithm dagitty and this repo's own packages/graph/src/dsep.ts both use.
See packages/validation/scripts/README.md for that call.

Unlike the other generate_*_fixture.py scripts, this one is purely
structural: no sampling, no seed, no N -- d-separation is a property of the
graph, not the data. It hand-implements the backdoor criterion (reject any Z
containing a descendant of X; otherwise cut X's outgoing edges and check
d-separation of X,Y given Z in the mutilated graph) directly against
networkx's DiGraph/is_d_separator, mirroring backdoor.ts's algorithm
independently in a different library -- the same independent-implementation
principle the other fixtures use, applied to graph structure instead of
numeric estimation.

Covers confounding.scm, collider.scm, mediator.scm (mirroring the assertions
already in packages/graph/src/backdoor.test.ts) plus the inline M-bias graph
from that same test file, since M-bias is the one case the cheap
descendant-exclusion shortcut can't catch on its own -- only the
moralization/d-separation logic can, so it's the more rigorous check of the
two libraries' agreement.

Run: uv run python scripts/generate_dsep_fixture.py
"""

import itertools
import json
from pathlib import Path

import networkx as nx

MODELS = {
    "confounding.scm": {
        "edges": [("C", "X"), ("X", "Y"), ("C", "Y")],
        "observed": ["C", "X", "Y"],
        "treatment": "X",
        "outcome": "Y",
        "checks": [[], ["C"]],
    },
    "collider.scm": {
        "edges": [("X", "S"), ("Y", "S")],
        "observed": ["X", "Y", "S"],
        "treatment": "X",
        "outcome": "Y",
        "checks": [[], ["S"]],
    },
    "mediator.scm": {
        "edges": [("X", "M"), ("M", "Y")],
        "observed": ["X", "M", "Y"],
        "treatment": "X",
        "outcome": "Y",
        "checks": [[], ["M"]],
    },
    "m-bias (inline, packages/graph/src/backdoor.test.ts)": {
        # latent U1 ~ Normal(0,1); latent U2 ~ Normal(0,1);
        # X = U1 + eps; Y = X + U2 + eps; M = U1 + U2 + eps
        "edges": [("U1", "X"), ("X", "Y"), ("U1", "M"), ("U2", "Y"), ("U2", "M")],
        "observed": ["X", "Y", "M"],  # U1, U2 are latent -- real nodes, excluded from adjustment search
        "treatment": "X",
        "outcome": "Y",
        "checks": [[], ["M"]],
    },
}


def descendants_of(g: nx.DiGraph, x: str) -> set[str]:
    return nx.descendants(g, x)


def mutilated(g: nx.DiGraph, x: str) -> nx.DiGraph:
    g2 = g.copy()
    g2.remove_edges_from(list(g2.out_edges(x)))
    return g2


def backdoor_valid(g: nx.DiGraph, x: str, y: str, z: set[str]) -> bool:
    if z & descendants_of(g, x):
        return False
    return nx.is_d_separator(mutilated(g, x), {x}, {y}, z)


def find_backdoor_set(g: nx.DiGraph, x: str, y: str, observed: list[str]) -> list[str] | None:
    candidates = sorted(v for v in observed if v not in (x, y) and v not in descendants_of(g, x))
    for size in range(len(candidates) + 1):
        for combo in itertools.combinations(candidates, size):
            if backdoor_valid(g, x, y, set(combo)):
                return list(combo)
    return None


def main() -> None:
    cases = []
    for model_name, spec in MODELS.items():
        g = nx.DiGraph()
        g.add_nodes_from(spec["observed"])
        g.add_edges_from(spec["edges"])
        x, y = spec["treatment"], spec["outcome"]

        adjustment_sets_checked = [{"z": z, "valid": backdoor_valid(g, x, y, set(z))} for z in spec["checks"]]
        minimal = find_backdoor_set(g, x, y, spec["observed"])

        cases.append(
            {
                "model": model_name,
                "edges": [list(e) for e in spec["edges"]],
                "treatment": x,
                "outcome": y,
                "adjustment_sets_checked": adjustment_sets_checked,
                "minimal_backdoor_set": minimal,
            }
        )

    fixture = {
        "problem": "d-separation / backdoor-criterion adjustment sets",
        "dgp": "purely structural (graph topology only, no sampling)",
        "cases": cases,
        "references": {"networkx": nx.__version__},
    }

    out_path = Path(__file__).parent.parent / "fixtures" / "dsep-adjustment-sets.json"
    out_path.write_text(json.dumps(fixture, indent=2) + "\n")
    print(f"wrote {out_path}")
    print(json.dumps(fixture, indent=2))


if __name__ == "__main__":
    main()
