# pi-spec-graph

## Specs: pi-spec-graph

The package comes from the ThinkRail repository (Apache-2.0). It is portable and runs under plain `pi`.

```sh
git clone --depth 1 https://github.com/JetBrains/thinkrail.git ~/src/thinkrail
pi install ~/src/thinkrail/packages/spec-graph
pi install ~/src/thinkrail/packages/pi-todos
```

It adds the tools `spec_grep`, `spec_get`, `spec_graph`, `spec_create`, `spec_update`, `spec_delete` and
`spec_validate`, plus the skill `spec-graph`. `pi-todos` adds the `todo_*` tools and the chat plan.

- **Both packages are `private: true` and absent from npm** (`npm view pi-spec-graph` returns 404).
  Install from a local path only. Pin the repository commit.
- **`pi install` writes the path relative to `PI_CODING_AGENT_DIR`.** Moving the agent directory breaks
  the install: reinstall from the new location.
- **`pi-spec-graph` needs the `yaml` module.** Without it the extension fails to load with
  `Cannot find module 'yaml'` from `core/parse.ts`. `npm install` inside the package fails on the
  `catalog:` protocol (bun workspace), and bun is not installed here. This workaround runs:

```sh
cd ~/.hermes/cache/scratch && npm pack yaml@2.9.1
mkdir -p ~/src/thinkrail/packages/spec-graph/node_modules
tar xzf yaml-2.9.1.tgz -C ~/src/thinkrail/packages/spec-graph/node_modules
mv ~/src/thinkrail/packages/spec-graph/node_modules/package \
   ~/src/thinkrail/packages/spec-graph/node_modules/yaml
```

`pi-todos` has no runtime dependencies and loads at once.

- **A file is a spec when its frontmatter carries `id` and `type`.** `parent` builds the hierarchy that
  mirrors the code. `depends-on`, `references` and `implements` build the dependency layer.
  `spec_validate` reports dangling links, duplicate `id` values and `parent` cycles.
- **The tools change frontmatter only.** Prose is written with the normal `edit` tool.
- **A change that moves a boundary updates the spec in the same change.** A spec that drifts from the
  code stops being ground truth.

