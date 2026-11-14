# Design — what the slices must agree on

The contract lane writes this beside `_contract.py`. It is short on purpose: the interface section is the
file itself, so this document holds only what a signature cannot say.

    ## Interfaces
        <package>/_contract.py holds every shared signature; quote nothing here, keep the file canonical.

    ## Data model
        <store or file>   <the columns or keys, their types and what makes a row unique>
        <path>            <what lives there, who writes it, who reads it>

    ## Decisions
        D1  <the decision>  — because <the one fact that settles it>.  Rejected: <the alternative>.

    ## Boundaries
        <what this system does not do, so no slice invents it>

Rules:

1. Every decision names the reason. A decision without a reason gets reopened by the next lane.
2. The data model names keys and uniqueness, not prose: "tracks(key TEXT PRIMARY KEY, path TEXT, status TEXT,
   attempts INTEGER)".
3. Boundaries are part of the design: a lane that invents an out-of-scope feature breaks the task's shape.
