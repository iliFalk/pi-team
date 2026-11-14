# Contract brief — the one lane that runs before the slices

One lane, one file, and every shared shape in it. This lane exists so the slices cannot disagree about what
a function returns. Budget: 1 500 characters.

    Lane contract. Work only inside your worktree. Edit the files now; do not describe a plan.
    Do not commit, do not ask a question — state an assumption in the report and continue.

    ## Your files — these and nothing else
        <package>/_contract.py        every shared name, with its full signature and return shape
        tests/test_contract.py        one test per name: `inspect.signature` and the shape of one return
                                      value — an import alone proves nothing

    ## Facts
        the repository holds <state: .gitkeep only / the modules below already>
        python 3.<x>, standard library only
        Every body raises NotImplementedError. Do not implement behaviour — declare it.

    ## Names the slices will call (declare each one exactly like this)
        <function>(<arg>: <type>, ...) -> <return type and, for a dict or tuple, its keys in order>
        <class>.<method>(<arg>: <type>) -> <return type>
        <module-level constant or key>  <meaning>

    ## Done means
        python3 -m unittest discover -s tests prints OK, and one test per declared name asserts BOTH:
        `inspect.signature(<name>)` equals the declared parameters — their names, order, defaults and
        annotations — and calling it raises NotImplementedError. An import that passes while the
        arguments are wrong is the seam this lane exists to close: the first slice codes against the
        signature it reads, and the mismatch lands in the merge, not here.

    ## Report
        the declared names with their signatures, the test output verbatim, and what the slices must not
        change.

After this lane merges, every slice brief carries one line: "implement the signatures declared in
`<package>/_contract.py`; do not change them; `tests/test_contract.py` must stay green."
