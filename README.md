# pendix

Pendix is a coding agent in your terminal with a learning layer for grading, notes, assessments, teach mode, groups, and human mentors.

Pendix is built on OpenCode (MIT licence).

## Run from source

Install dependencies:

```sh
bun install
```

Start the terminal app from source:

```sh
bun run --cwd packages/cli dev
```

Build a local `pendix` binary for your current platform:

```sh
bun run --cwd packages/cli build --single --skip-install
```

The built binary is written to `packages/cli/dist/cli-<os>-<arch>/bin/pendix`.

## Configuration

Pendix stores global config, data, cache, and state in standard XDG paths:

- Config: `~/.config/pendix/pendix.json` (or `pendix.jsonc`)
- Data: `~/.local/share/pendix`
- Cache: `~/.cache/pendix`
- State: `~/.local/state/pendix`

Project configuration lives in `pendix.json` or `.pendix/pendix.json`. Project instructions stay in `AGENTS.md`.

## Providers and models

Pendix lists providers where you bring your own API key, plus free models from the catalog. It makes no network calls to third-party hosted gateways, share servers, or telemetry endpoints.

## Syncing upstream

See [UPSTREAM.md](./UPSTREAM.md) for the exact steps to fetch and merge upstream changes.

## License

MIT. See [LICENSE](./LICENSE).
