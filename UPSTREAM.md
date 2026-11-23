# Syncing Upstream Changes

Pendix is a fork of OpenCode. Follow this runbook whenever you want to pull upstream commits into Pendix safely.

## Quick start

Run the helper script from the repository root:

```sh
./scripts/upstream-sync.sh
```

The script checks for a clean working tree, fetches `upstream`, creates a dated sync branch, and merges `upstream/dev`. If git reports merge conflicts, the script stops and prints the conflicted files so you can resolve them by hand.

## Exact manual commands

### 1. Make sure the `upstream` remote exists

```sh
git remote -v
```

If `upstream` is missing, add it:

```sh
git remote add upstream https://github.com/anomalyco/opencode.git
```

### 2. Fetch upstream and create a sync branch

Start from an up-to-date `dev` branch with a clean working tree:

```sh
git status
git fetch upstream
git checkout -b upstream-sync-$(date +%Y%m%d)
```

### 3. Merge upstream into the sync branch

```sh
git merge upstream/dev --no-edit
```

Do not merge directly onto `dev` or `main`. Always use a dedicated sync branch.

### 4. Resolve conflicts in renamed and rebranded files

Because Pendix renames the CLI binary, workspace scope, config directories, and user-visible branding, expect conflicts in these files:

- **Workspace package names and imports**: `package.json`, `packages/*/package.json`, `.oxlintrc.json`, `turbo.json`, and any newly added files that import `@opencode/*`.
  - Keep internal workspace packages under `@pendix/*` and the root/CLI package named `pendix`.
  - Keep external npm package `@opencode/pty` (and `@opencode/pty-*`) untouched.
- **CLI binary and packaging**: `packages/cli/bin/pendix.cjs`, `packages/cli/script/build.ts`, `packages/cli/script/pack.ts`, `packages/cli/script/postinstall.mjs`, `packages/cli/script/build-node.ts`.
  - If upstream edits `packages/cli/bin/opencode.cjs` or `opencode2.cjs`, port the change into `packages/cli/bin/pendix.cjs` and delete the upstream `opencode*.cjs` files (`git rm packages/cli/bin/opencode.cjs packages/cli/bin/opencode2.cjs`).
- **Config, data, cache, and database paths**:
  - `packages/util/src/global.ts` (`app = "pendix"`)
  - `packages/cli/src/database-path.ts` (`pendix.db`)
  - `packages/core/src/config/discovery.ts` (`pendix.json`, `pendix.jsonc`, `.pendix`)
  - `packages/core/src/plugin/plan.ts` (`.pendix/plan`)
  - `packages/tui/src/util/config-directories.ts` and `packages/tui/src/plugin/discovery.ts` (`.pendix`)
  - `packages/cli/src/commands/handlers/mcp/add.ts` (`pendix.json`)
- **Disabled OpenCode servers and telemetry**:
  - `packages/util/src/observability/otlp.ts` (keep OTLP export disabled)
  - `packages/core/src/models-dev.ts` (keep `defaultSource = "https://models.dev"` and keep `@opencode/ai/` -> `@pendix/ai/` normalization in `loadable()`)
  - `packages/core/src/plugin/models-dev.ts` (keep filtering out `opencode` and `opencode-go`)
  - `packages/core/src/plugin/provider.ts` and `packages/core/src/plugin/internal.ts` (keep `OpencodePlugin` removed)
  - `packages/core/src/usage-limits.ts` (keep OpenCode Console calls disabled)
  - `packages/core/src/voice.ts` (keep OpenCode hosted GPT-Live fallback removed)
  - `packages/cli/src/services/updater.ts` (keep OpenCode update checks disabled or pointed at the Pendix release feed)
- **User-visible branding and legal files**:
  - `packages/cli/src/commands/commands.ts`
  - `packages/tui/src/logo.ts` and `packages/tui/src/component/logo.tsx`
  - `sdks/vscode/package.json` and `sdks/vscode/src/extension.ts`
  - `install`, `LICENSE` (keep both copyright lines), and `README.md` (keep attribution line)

If upstream introduces new internal imports of `@opencode/<pkg>`, replace them with `@pendix/<pkg>` (excluding `@opencode/pty*`), then refresh the lockfile:

```sh
bun install
```

Stage resolved files and finish the merge commit:

```sh
git add -A
git merge --continue
```

### 5. Verify branding, tests, lint, and typecheck

```sh
bun scripts/check-branding.ts
bun run --cwd packages/cli test test/pendix-rebrand.test.ts
bun run --cwd packages/core test test/pendix-rebrand.test.ts
GITHUB_ACTIONS=false bun turbo test --concurrency=3
bun run lint
bun run typecheck
```

Once everything passes, review the diff against `dev` and merge the sync branch back into `dev`.
