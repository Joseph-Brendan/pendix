# ENGINE-NOTES.md: OpenCode V2 Engine Map

This repository is a fork of OpenCode v2.4.0 (`package.json`, Bun 1.4.4 monorepo managed by Turborepo). The architecture is Effect-based (`effect` 4.x) with strict layer direction: `schema` -> `core` and `protocol` -> `server` -> `client` / `cli` / `tui`.

Start the terminal app from source:

```bash
bun install
bun dev [directory]
```

`bun dev` runs `bun run --cwd packages/cli src/index.ts`. Pass `--standalone` to run a private local server instead of reusing or starting the shared background service (`bun dev --standalone .`).

---

## 1. Repository Organisation

Workspaces are declared in `package.json` (`packages/*`, `packages/plugins/*`, `services/*`, `packages/data/*`).

### Core Engine, Server, CLI, and TUI

| Folder | Package Name | Purpose |
| --- | --- | --- |
| `packages/util` | `@opencode/util` | Shared low-level utilities: XDG/global paths, file locking, process spawning, npm helpers, OTLP logging/tracing, Effect `LayerNode` helpers. |
| `packages/schema` | `@opencode/schema` | Shared Effect schemas for wire and storage contracts (sessions, messages, events, config, models, providers, credentials, tools, permissions). |
| `packages/ai` | `@opencode/ai` | Schema-first LLM and media client built on Effect (text, images, video, decisions, embeddings, realtime voice, provider adapters). |
| `packages/codemode` | `@opencode/codemode` | Confined JS-like interpreter (`psychoscript`) for schema-described tool execution. |
| `packages/plugin` | `@opencode/plugin` | Authoring interfaces and runtime loader for OpenCode V2 plugins (Promise API, Effect API, GUI plugin SDK). |
| `packages/core` | `@opencode/core` | Domain logic and SQLite persistence (Drizzle): sessions, event bus, runner, agents, tools, config, credentials, Models.dev catalog, built-in plugins, MCP, PTY, VCS, worktrees. |
| `packages/protocol` | `@opencode/protocol` | Public Effect `HttpApi` endpoint definitions (`packages/protocol/src/groups/*`) and generated `openapi.json`. |
| `packages/server` | `@opencode/server` | HTTP server and SSE event feed composing `@opencode/core` and `@opencode/protocol`, plus Cloudflare `workerd` adapter. |
| `packages/httpapi-codegen` | `@opencode/httpapi-codegen` | Build-time code generator that derives typed Promise and Effect clients from `HttpApi` definitions. |
| `packages/client` | `@opencode/client` | Generated Promise, Effect, and SolidJS clients plus background service discovery/lifecycle (`Service.ensure`, `Service.discover`). |
| `packages/sdk` | `@opencode/sdk` | In-process SDK that runs `@opencode/server`'s router in memory without opening a network listener. |
| `packages/theme` | `@opencode/theme` | Semantic TUI theme schema, token resolution, syntax/diff tokens, and V1-to-V2 theme migration. |
| `packages/tui` | `@opencode/tui` | Terminal UI built on SolidJS and `@opentui/solid` / `@opentui/core`, plus minimal interactive mode (`mini`). |
| `packages/cli` | `@opencode/cli` | Main CLI entrypoint, command handlers, background service orchestration, updater, ACP server, and binary build/pack scripts. |
| `packages/process-daemon` | (Rust crate) | Persistent PTY daemon (`opencode-pty`) for background terminals that survive server restarts. |
| `packages/latex` | `@opencode/latex` | Terminal LaTeX math parser and text layout renderer used by `@opencode/tui`. |
| `packages/merman` | `@opencode/merman` | Terminal Mermaid diagram renderer (flowcharts, Gantt, gitgraph) used by `@opencode/tui`. |
| `packages/patchmark` | `@opencode/patchmark` | Streaming/incremental Markdown parser and HTML healer. |
| `packages/script` | `@opencode/script` | Shared build, versioning, release highlights, and packaging helpers for workspace scripts. |
| `packages/http-recorder` | `@opencode/http-recorder` | Deterministic HTTP/WebSocket cassette recorder/replayer for tests. |
| `packages/simulation` | `@opencode/simulation` | Simulated backend and control server for deterministic UI/TUI/E2E testing. |

### Web UI, Desktop App, Extensions, and Extra Plugins

| Folder | Package Name | Purpose |
| --- | --- | --- |
| `packages/ui` | `@opencode/ui` | Shared SolidJS web design system and base components. |
| `packages/session-ui` | `@opencode/session-ui` | Shared SolidJS session transcript and timeline components. |
| `packages/app` | `@opencode/app` | Shared SolidJS web frontend (served by the local server and embedded in Desktop). |
| `packages/desktop` | `@opencode/desktop` | Electron desktop application wrapping `packages/app` and managing the local server. |
| `packages/gui-plugins` | `@opencode/gui-plugins` | Built-in GUI plugins for the web and desktop apps (terminal, review, files, browser, SSH, WSL, updater, pairing). |
| `packages/plugin-browser` | `@opencode/plugin-browser` | Server/desktop browser automation plugin over CDP and Code Mode. |
| `packages/plugins/figma` | `@opencode/plugin-figma` | Built-in Figma MCP integration and skills. |
| `packages/stories` | `@opencode/stories` | Vite Storybook/component test harness for web UI packages. |
| `packages/nav-menus` | `@opencode/nav-menus` | Shared navigation menu and brand components for OpenCode web properties. |
| `packages/identity` | (assets) | OpenCode SVG and PNG brand marks. |
| `packages/cli-rs` | `@opencode/cli-rs` | Experimental Rust CLI/TUI rewrite (`opencode-native`, not shipped yet). |
| `packages/effect-drizzle-sqlite` | (examples) | Example code for Effect + Drizzle SQLite integration. |
| `packages/data/{app,core,server}` | `@opencode/data-{app,core,server}` | Public OpenCode usage/stats site (`opencode.ai/data`), database schema, and Cloudflare sync workflows. |
| `sdks/vscode` | `opencode` | VS Code extension that opens the `opencode` CLI in an integrated terminal. |

### Services and Top-Level Support Folders

| Folder | Purpose |
| --- | --- |
| `services/site` | The `opencode.ai` marketing website and V2 documentation (`@opencode/site`). |
| `services/update` | Cloudflare Worker serving release metadata and update selection (`@opencode/update`). |
| `services/files` | Cloudflare Worker serving public release files at `/files/*` (`@opencode/files`). |
| `services/data` | Cloudflare deployment wrapper for `packages/data/*` (`@opencode/data`). |
| `services/legacy` | Deprecated Cloudflare Worker for `opncd.ai` and `api.opencode.ai` (`@opencode/legacy`). |
| `salesforce/` | Salesforce SFDX app (upstream internal/partner tooling). |
| `nix/`, `flake.nix`, `flake.lock` | Nix packaging definitions for CLI and Electron desktop builds. |
| `script/` | Repo-wide lint, release, typecheck profiling, and OpenTUI/MCP upgrade scripts. |
| `patches/` | Bun `patchedDependencies` patches for third-party packages. |
| `golden/` | Pendix human-graded prompt dataset (`golden/golden-prompts.json`). |

---

## 2. Terminal App Entry Point, Binary Naming, and Build

- **CLI entry point**: `packages/cli/src/index.ts`. It sets `NO_PROXY`/`no_proxy` for localhost, initializes the plugin runtime, wires Effect CLI command specs (`packages/cli/src/commands/commands.ts`) to lazy handlers, and runs `Runtime.run(...)`.
- **Default command -> TUI launch**: When invoked with no subcommand (or a directory path), `packages/cli/src/commands/handlers/default.ts` resolves or starts the local server via `ServerConnection.resolve(...)` (`packages/cli/src/services/server-connection.ts`) and calls `run(...)` from `@opencode/tui` (`packages/tui/src/index.tsx` -> `packages/tui/src/app.tsx`).
- **Command and binary names**:
  - Root CLI command name: `OPENCODE_CLI_NAME` compile-time define (defaults to `"opencode"`) in `packages/cli/src/commands/commands.ts`.
  - npm `bin` entries in `packages/cli/package.json`: `"opencode": "./bin/opencode.cjs"` and legacy alias `"opencode2": "./bin/opencode2.cjs"`.
  - `packages/cli/bin/opencode.cjs` is a Node wrapper that detects OS/arch/libc/AVX2 support and spawns the platform binary from `@opencode/cli-<os>-<arch>[-baseline][-musl]/bin/opencode[.exe]` (or `OPENCODE_BIN_PATH`).
- **How binaries are built**:
  - **Primary (Bun compiled binary)**: `packages/cli/script/build.ts` (`bun run --cwd packages/cli build`, or `--single` for host-only). Uses `Bun.build({ compile: ... })` across 12 targets (`linux`/`darwin`/`win32` x `arm64`/`x64`, plus `baseline` non-AVX2 and Linux `musl`). It embeds the web UI archive (`packages/cli/script/app-assets.ts`), the Models.dev snapshot (`packages/core/script/models-snapshot.ts`), native bindings (`@parcel/watcher`, `@number0/iroh`, `opencode-pty`), SolidJS transforms, and compile-time defines (`OPENCODE_VERSION`, `OPENCODE_CLI_NAME`, `OPENCODE_CHANNEL`, `OPENCODE_ARTIFACT`). Output goes to `packages/cli/dist/cli-<target>/bin/opencode[.exe]`.
  - **Secondary (Node 26.4 SEA build)**: `packages/cli/script/build-node.ts` (`bun run --cwd packages/cli build:node`). Bundles via Vite (`packages/cli/vite.node.config.ts`) into a Node Single Executable Application (`opencode2-node`) for 5 targets (excludes `darwin-x64`).

---

## 3. Local Server and TUI Communication

- **Where the local server lives**:
  - Process bootstrap and HTTP listener: `packages/server/src/process.ts` (`ServerProcess.start`, using `node:http` via `@effect/platform-node`'s `NodeHttpServer`).
  - Route composition and Effect layer graph: `packages/server/src/routes.ts` and `packages/server/src/handlers.ts` (implementing `@opencode/protocol`'s `Api` in `packages/server/src/api.ts` and `packages/server/src/handlers/*`).
  - CLI server process wrapper: `packages/cli/src/server-process.ts` (invoked by `opencode serve`, `opencode serve --service`, or `opencode serve --stdio`).
  - Default bind address: `127.0.0.1` on port `49374` (`0xC0DE`, or `0xC0DF` = `49375` for channel `local`, or `0x70DE` on Windows) for managed background service (`packages/cli/src/services/service-config.ts`), or starting at `4096` incrementing if busy for foreground `serve` (`packages/server/src/process.ts`).
  - Authentication: HTTP Basic Auth with username `"opencode"` and a random 32-byte base64url password (`packages/server/src/auth.ts`, `packages/server/src/middleware/authorization.ts`), stored in the service config file and registration file under `XDG_STATE_HOME`.
- **How the TUI connects and talks to the server**:
  1. `packages/cli/src/services/server-connection.ts` discovers an existing background service via `Service.ensure` / `Service.discover` (`packages/client/src/effect/service.ts`), starts a private `--stdio` server (`packages/cli/src/services/standalone.ts`) if `--standalone` is set, or connects to an explicit `--server <url>`.
  2. `packages/tui/src/app.tsx` creates a generated Promise client (`OpenCode.make(...)` from `@opencode/client`) configured with `baseUrl` and Basic Auth headers, and passes it into `ClientProvider` (`packages/tui/src/context/client.tsx`).
  3. **Request/response**: Standard JSON HTTP requests against `/api/*` endpoints defined in `packages/protocol/src/groups/*`.
  4. **Live updates**: Server-Sent Events (SSE) on `GET /api/event` (`packages/protocol/src/groups/event.ts`, `packages/server/src/handlers/event.ts`, `packages/server/src/event-feed.ts`), consumed by `createClientConnection` (`packages/client/src/solid/connection.ts`) and re-emitted on a SolidJS event bus inside `packages/tui/src/context/client.tsx` to update stores in `packages/tui/src/context/data.tsx`.
  5. **Interactive PTYs**: WebSockets authenticated by short-lived tickets (`packages/protocol/src/groups/pty.ts`, `packages/protocol/src/groups/persistent-pty.ts`, `packages/client/src/solid/pty.ts`).

---

## 4. Sessions, Messages, Tool Calls, and Lifecycle Events

### Creation and Storage

- **SQLite database**: Opened and migrated by `packages/core/src/database/database.ts` and `packages/core/src/database/migration.ts`. The CLI resolves the file path in `packages/cli/src/database-path.ts` to `<XDG_DATA_HOME>/opencode/opencode.db` (or `opencode-<channel>.db` for non-standard channels, overridable via `OPENCODE_DB`), chmod `0o600` on POSIX.
- **Core tables**:
  - `event_sequence` and `event` (`packages/core/src/event/sql.ts`): Append-only durable event log per aggregate (`sessionID`), written atomically by `Bus.Service` (`packages/core/src/bus.ts`).
  - `session_v2`, `session_message`, `session_part`, `session_inbox`, `instruction_entry`, `instruction_blob`, `instruction_state`, `blob`, `blob_ref` (`packages/core/src/session/sql.ts`): Projected read models maintained transactionally by `SessionProjector` (`packages/core/src/session/projector.ts`).
- **How records are created**:
  - **Sessions**: `Session.Service.create` in `packages/core/src/session.ts` publishes `session.created`, which `SessionProjector` inserts into `session_v2`.
  - **User prompts / messages**: `Session.prompt` (`packages/core/src/session/session.ts`) prepares attachments via `SessionPrompt.prepare` (`packages/core/src/session/prompt.ts`), admits the item into `session_inbox` via `SessionInbox.admit` (`packages/core/src/session/inbox.ts`), and wakes execution. When promoted, `SessionProjector` deletes the inbox row and inserts the visible `user` row in `session_message`.
  - **Assistant steps and tool calls**: `SessionRunnerLLM` (`packages/core/src/session/runner/llm.ts`) runs one step at a time via `SessionStep.attempt` (`packages/core/src/session/runner/step.ts`). `createLLMEventPublisher` (`packages/core/src/session/runner/publish-llm-event.ts`) emits durable step, text, reasoning, and tool events; `SessionProjector` projects the assistant envelope into `session_message` and individual text/reasoning/tool-call parts into `session_part` (keyed by `(message_id, ordinal)`, with `call_id` for tool calls).

### Events Fired Across the Lifecycle

All event schemas live in `packages/schema/src/session-event.ts` (and deprecated `packages/schema/src/session-status-event.ts`, which V2 core does not emit).

1. **When a user sends a prompt**:
   - Plugin hook: `session.prompt` triggers in `packages/core/src/session/prompt.ts` (can inspect/modify prompt text, files, metadata, delivery).
   - Durable event: `session.inbox.enqueued` (admits work into `session_inbox`).
   - `SessionExecution.wake(sessionID)` (`packages/core/src/session/execution.ts`) starts a run via `SessionRunCoordinator` (`packages/core/src/session/run-coordinator.ts`) and publishes durable `session.execution.started` (also writing the crash-recovery claim `time_suspended` on `session_v2`).
   - Durable event: `session.inbox.delivered` (from `SessionInbox.promote` in `packages/core/src/session/inbox.ts`, consuming the inbox row and inserting the visible `user` message into `session_message`).
2. **During each LLM step and tool call**:
   - Durable `session.step.started`, `session.step.first-token`.
   - Text/reasoning: durable `session.text.started` / `session.text.ended`, `session.reasoning.started` / `session.reasoning.ended`; ephemeral `session.text.delta` and `session.reasoning.delta`.
   - Tool calls: durable `session.tool.input.started` / `session.tool.input.ended` (ephemeral `session.tool.input.delta`), durable `session.tool.called`, ephemeral `session.tool.progress`, and terminal durable `session.tool.success` or `session.tool.failed`. Plugin hooks `tool.execute.before` and `tool.execute.after` also run around tool execution.
   - Durable `session.step.streamed`, then durable `session.step.ended` (with `finish`, `cost`, `tokens`, `snapshot`, `files`) or `session.step.failed`. `SessionProjector` also publishes ephemeral `session.usage.updated`.
   - If the step executed tool calls (or needs continuation), `SessionRunnerLLM` loops to the next step from reloaded SQLite history.
3. **When the agent finishes a turn** (all steps for the prompt complete and inbox is empty):
   - Plugin hook: `session.experimental.idle` fires in `packages/core/src/session/runner/llm.ts` (line 184) right before the runner returns `DrainResult.Complete()`.
   - Durable terminal execution event from `SessionExecution` (`packages/core/src/session/execution.ts`, `settled` callback):
     - `session.execution.succeeded` (normal completion)
     - `session.execution.failed` (unrecoverable error)
     - `session.execution.interrupted` (`reason: "user" | "shutdown" | "superseded" | "inactivity"`)
   - `SessionProjector` sets `time_idle` and `idle_outcome` on `session_v2`.
4. **When a session ends**:
   - Sessions are persistent records in SQLite; closing the TUI only disconnects the SSE stream and does not emit a separate "session closed" event.
   - Explicit session-ending durable events are:
     - `session.archived` (via `Session.archive` in `packages/core/src/session/session.ts`)
     - `session.deleted` (via `Session.remove` in `packages/core/src/session.ts`)
     - `session.execution.interrupted` (when interrupted by user stop or server shutdown).

---

## 5. Agents and System Prompts

- **Agent service and registry**: `packages/core/src/agent.ts` (default agent ID `"build"`), schema in `packages/schema/src/agent.ts`.
- **Built-in agent definitions**:
  - `packages/core/src/plugin/agent.ts` (`opencode.agent` plugin): defines `build` (primary default), `general` (subagent), `explore` (read-only subagent with inline `PROMPT_EXPLORE`), plus hidden utility agents `compaction`, `title` (`PROMPT_TITLE`), and `summary` (`PROMPT_SUMMARY`).
  - `packages/core/src/plugin/plan.ts` (`opencode.plan` plugin): defines `plan` (primary read-only agent; denies `edit` outside `~/.opencode/plan/*` and injects `<system-update>` enter/leave reminders via `session.context` hook and `session.created`/`session.agent.selected` events).
- **Custom/user/project agents**: Loaded by `packages/core/src/config/plugin/agent.ts` (`opencode.config.agent`) from config JSON `agents` entries and Markdown files matching `{agent,agents}/**/*.md` and `{mode,modes}/*.md` inside global and project `.opencode` config directories.
- **System prompts**:
  - Base harness prompt template: `packages/core/src/session/runner/prompt/system.txt`, rendered with tool guidance by `packages/core/src/session/system-prompt.ts`.
  - Model-family prompt overrides/appends: `packages/core/src/plugin/optimize.ts` hooks `session.context`, `session.compaction`, and `session.generate` to apply templates from `packages/core/src/plugin/system-prompt/`:
    - `anthropic.txt` (appended for `claude` models)
    - `gpt.txt` and `gpt-astra.txt` (override for `gpt` / `astra` models)
    - `kimi.txt` (override for `kimi` models)
    - `trinity.txt` (override for `trinity` models)
    - `meta.txt` (override for `muse` models)
  - Model identity block (`# Your Model`): injected into `event.system[1]` by `packages/core/src/plugin/identity.ts`.
  - All internal plugins are registered in `packages/core/src/plugin/internal.ts`.

---

## 6. Model List (Models.dev), Provider Keys, and Free Models

- **Where the model list comes from**:
  - `packages/core/src/models-dev.ts` (`ModelsDev.Service`) fetches the catalog from `https://models.opencode.ai/experimental/v2.0/api.json?type=chat,decision,image,video,realtime&include=openai-codex,openai-chatgpt` every 5 minutes (overridable via `OPENCODE_MODELS_URL`, local file `OPENCODE_MODELS_PATH`, or disabled via `OPENCODE_DISABLE_MODELS_FETCH`).
  - A bundled fallback snapshot lives at `packages/core/src/models-dev/snapshot.txt` (refreshed via `packages/core/script/update-models-snapshot.ts` and embedded in builds by `packages/core/script/models-snapshot.ts`).
  - Live fetches are cached in SQLite's `kv` table (`models-dev:v3:catalog`).
  - `packages/core/src/plugin/models-dev.ts` (`ModelsDevPlugin`) registers providers, models, and auth methods (API key + env var names) from the normalized catalog; `packages/core/src/provider.ts` and `packages/core/src/model.ts` materialize the active provider/model snapshots.
- **How provider keys are stored**:
  - Stored in the SQLite `credential` table (`packages/core/src/credential/sql.ts`, `packages/core/src/credential.ts`) inside `<XDG_DATA_HOME>/opencode/opencode.db` (file mode `0o600` on POSIX, plaintext JSON in the `value` column for `key` and `oauth` credentials; no OS keychain is used in the CLI/server).
  - On first bootstrap of a file database, `packages/core/src/database/migration/20260805200742_import_legacy_credentials.ts` imports legacy V1 `auth.json` credentials.
  - Provider keys can also come from process environment variables (or `env` saved in `<XDG_CONFIG_HOME>/opencode/service.json`, mode `0o600`, via `opencode service set env <NAME> <VALUE>` in `packages/cli/src/services/service-config.ts`).
- **How free models are shown**:
  - By default (unless `OPENCODE_DISABLE_FREE_MODELS=1|true`), `packages/core/src/plugin/provider/opencode.ts` (lines 481-507) automatically activates the `opencode` provider with `apiKey: "public"` when no OpenCode account or API key is configured, and disables paid models (`cost.input > 0`) so only free models remain enabled. Those free models route through OpenCode's hosted gateway (`https://opencode.ai/inference/...` in `packages/core/src/models-dev/snapshot.txt`).
  - When only free `opencode` models are enabled, `packages/core/src/model.ts` (`preferFree`, lines 337-350) pins `PREFERRED_FREE` (`big-pickle`, `deepseek-v4.1-flash-free`, `muse-spark-1.3-contributor-free`) at the front of `Model.available()`.
  - In the TUI:
    - `isFreeModel` in `packages/tui/src/component/model-options.tsx` checks `cost.every((c) => c.input === 0)` and renders `"Free"` in `ModelDetail`.
    - `sortModelOptions` (`packages/tui/src/component/model-options.tsx`) puts `opencode-go` and `opencode` providers first and free models ahead of paid ones.
    - `packages/tui/src/component/dialog-model-free.tsx` (`DialogFreeModels`) shows a dedicated `"Free models"` picker when no provider is connected (used by `packages/tui/src/component/dialog-model.tsx`).
    - `packages/tui/src/feature-plugins/sidebar/footer.tsx` displays `"OpenCode includes free models so you can start immediately."`
    - When the free limit is hit (`provider.free-limit`), `packages/tui/src/routes/session/index.tsx` opens `DialogGoUpsell` (`packages/tui/src/component/dialog-go-upsell.tsx`) promoting OpenCode Go (`https://opencode.ai/go`).

---

## 7. Config Directory and File Names

- **Base global directories**: Defined in `packages/util/src/global-roots.ts` and `packages/util/src/global.ts` with `app = "opencode"` (respecting XDG env vars):
  - Config: `$XDG_CONFIG_HOME/opencode` (default `~/.config/opencode`), overridable via `OPENCODE_CONFIG_DIR`.
  - Data: `$XDG_DATA_HOME/opencode` (default `~/.local/share/opencode`) - holds `opencode.db`, `log/`, `repos/`.
  - Cache: `$XDG_CACHE_HOME/opencode` (default `~/.cache/opencode`) - holds `bin/`.
  - State: `$XDG_STATE_HOME/opencode` (default `~/.local/state/opencode`) - holds `service.json` registration and `locks/`.
  - Temp: `os.tmpdir()/opencode`.
- **Core config discovery and file names**: Defined in `packages/core/src/config/discovery.ts` and loaded by `packages/core/src/config.ts`:
  - Config filenames: `opencode.json` and `opencode.jsonc` (`ConfigDiscovery.names`). `packages/cli/src/services/updater.ts` also checks legacy `config.json`.
  - System config directory: `/Library/Application Support/opencode` (macOS), `/etc/opencode` (Linux), `%ProgramData%\opencode` (Windows), plus macOS MDM plist `/Library/Managed Preferences[/<user>]/ai.opencode.managed.plist`.
  - Global overlay per project: `<global.config>/project/<projectID>`.
  - Project walk-up directories/files: `.opencode/`, `opencode.json`, `opencode.jsonc`, plus compatibility directories `.claude/` and `.agents/` (and `~/.claude`, `~/.agents`).
  - Explicit overrides: `OPENCODE_CONFIG` (single file path) and `OPENCODE_CONFIG_CONTENT` (inline JSON/JSONC).
- **CLI/TUI config file**: `<global.config>/cli.json` (`packages/cli/src/config/config.ts`), with one-time migration from V1 `<global.config>/tui.json` and `<global.state>/kv.json` (`packages/cli/src/config/migrate.ts`), overridable via `OPENCODE_CLI_CONFIG_CONTENT`.
- **Background service config and registration files**: `<global.config>/service.json` (or `service-<channel>.json`) and `<global.state>/service.json` (`packages/cli/src/services/service-config.ts`).

---

## 8. Theme and Colours

- **Theme token schema and resolution engine**: `packages/theme/src/tui/`:
  - `schema.ts` and `types.ts`: semantic token contract (`hue.{gray,blue,orange,purple,red,green,accent,interactive,neutral}`, `text.*`, `background.*`, `border.*`, `scrollbar.*`, `diff.*`, `syntax.*`, `markdown.*`, surface overrides like `@dialog`).
  - `resolve.ts`, `expand.ts`, `color.ts`, `select.ts`, `syntax.ts`: resolves light/dark modes, `$token` references, and syntax highlighting styles.
  - `v1.ts`, `v1-migrate.ts`, `v1-migrate-new-designs.ts`: converts legacy V1 theme JSON files into V2 semantic themes.
- **Built-in TUI themes and colours**:
  - Default V2 themes: `packages/tui/src/theme/assets/v2/opencode.json` (`opencode`) and `packages/tui/src/theme/assets/v2/opencode-classic.json` (`opencode-classic`).
  - 32 additional built-in V1 themes (e.g. `catppuccin.json`, `dracula.json`, `github.json`, `nord.json`, `orng.json`, `tokyonight.json`, `vercel.json`): `packages/tui/src/theme/assets/*.json`, registered in `packages/tui/src/theme/v1.ts`.
  - Theme registry, system-theme generation, and runtime provider: `packages/tui/src/theme/index.ts`, `packages/tui/src/theme/system.ts`, `packages/tui/src/theme/resolve.ts`, `packages/tui/src/context/theme.tsx`.
  - Custom user/project theme discovery: `packages/tui/src/theme/discovery.ts` loads `<config-dir>/themes/*.json`.
- **Web/desktop UI colours** (not used by the terminal app): `packages/ui/src/theme/` and CSS tokens generated by `packages/ui/script/tailwind.ts`.

---

## 9. Existing IDE Extension

- **Location**: `sdks/vscode/` (manifest `sdks/vscode/package.json`, source `sdks/vscode/src/extension.ts`, bundler `sdks/vscode/esbuild.js`).
- **How it launches the terminal app**:
  - Registers three commands in `sdks/vscode/src/extension.ts`:
    - `opencode.openTerminal` (`cmd+escape` / `ctrl+escape`): focuses an existing VS Code terminal named `"opencode"`, or calls `openTerminal()`.
    - `opencode.openNewTerminal` (`cmd+shift+escape` / `ctrl+shift+escape`, plus editor title toolbar icon): always calls `openTerminal()`.
    - `opencode.addFilepathToTerminal` (`cmd+alt+k` / `ctrl+alt+K`): inserts `@<relative-path>[#start[-end]]` into the active `"opencode"` terminal via `terminal.sendText(fileRef, false)`.
  - `openTerminal()` opens a split-screen integrated terminal (`vscode.ViewColumn.Beside`) with env `OPENCODE_CALLER: "vscode"`, shows it, and runs `terminal.sendText("opencode")` so it launches whatever `opencode` binary is on the user's `PATH`.

---

## 10. Test Suite Execution and Timing

- **Guard at repo root**: Running `bun test` at the repo root is intentionally blocked (`package.json`: `"test": "echo 'do not run tests from root' && exit 1"`).
- **How to run**:
  - **All workspace unit tests (as in `.github/workflows/check-test.yml`)**:
    ```bash
    GITHUB_ACTIONS=false bun turbo test --concurrency=3
    ```
    (Add `--continue` to run all 33 packages even if one package fails.)
  - **Single package**: `cd packages/<name> && bun run test` (e.g. `cd packages/core && bun run test`, which executes `packages/core/script/test.ts` to isolate `HOME`/`XDG_*` into a temp directory and strip real API keys before invoking `bun test --only-failures --timeout=30000`).
  - **Browser E2E / component tests (Playwright, separate from `turbo test`)**:
    - `bun --cwd packages/app test:e2e:built`
    - `bun --cwd packages/app test:components`
    - `bun --cwd packages/session-ui test:components`
  - **VS Code extension tests**: `cd sdks/vscode && bun run test` (`vscode-test` / `@vscode/test-electron`).
  - **Lint and typecheck**: `bun run check` (`bun run lint && bun run typecheck` at repo root; `bun typecheck` or `bun run typecheck:tsc` per package).
- **Measured timing on this machine (macOS arm64, cold Turbo cache, `--concurrency=3`)**:
  - Full 33-package unit suite wall time: **~5m 45s** total across an initial pass (1m 13s, 27 packages passing before halting on `@opencode/gui-plugins`) and `--continue` pass (4m 31s for the remaining heavy suites).
  - Individual heavy engine suites:
    - `@opencode/core`: 166.31s (7999 tests across 359 files; 7929 pass, 39 skip, 31 fail - failures were mostly `glob`/`grep` ripgrep tests because `rg` was not on `PATH` and one bash compound-syntax check).
    - `@opencode/tui`: 164.35s (1737 tests across 204 files; 1735 pass, 2 skip, 0 fail).
    - `@opencode/cli`: 157.44s (441 tests across 62 files; 432 pass, 9 skip, 0 fail).
    - `@opencode/server`: 100.70s (165 tests across 52 files; 1 error).
    - `@opencode/gui-plugins`: 40.53s (2091 tests across 202 files; 2088 pass, 2 skip, 1 fail - Electron process exit test).
    - `@opencode/sdk`: 8.70s (40 tests across 11 files; 40 pass, 0 fail).
    - `@opencode/desktop`: 4.46s (595 tests across 77 files; 590 pass, 5 skip, 0 fail).
    - Remaining 26 packages all passed in under ~73s combined.

---

## 11. Release Builds: Binaries, npm Packages, and Install Script

- **Orchestration**:
  - Maintainer trigger script: `script/release.ts` (generates changelog and triggers `.github/workflows/release.yml` via `gh workflow run`).
  - Release workflow: `.github/workflows/release.yml` (jobs: `plan`, `verify`, `tag`, `models-catalog`, `build-cli`, `build-node`, `build-npm`, `build-docker`, `build-desktop`, `sign-macos`, `sign-windows`, `publish-attestations`, `publish-npm`, `publish-cli`, `publish-desktop`, `publish-docker`, `publish-homebrew`, `publish-aur`, `publish-winget`, `publish-github-release`, `publish-discord`, `publish-version-pr`).
- **Standalone binaries**:
  - Built by `packages/cli/script/build.ts` (12 Bun-compiled targets) and `packages/cli/script/build-node.ts` (5 Node SEA targets).
  - Packaged into `.tar.gz` (Linux) and `.zip` (macOS/Windows) archives in `dist/archives/` by `packages/cli/script/pack.ts`, signed on macOS/Windows, and uploaded to GitHub Releases and `services/files`.
- **npm packages**:
  - `packages/cli/script/pack.ts` generates per-platform binary packages (`@opencode/cli-<target>` and `@opencode/cli-node-<target>`) and a top-level wrapper package (`@opencode/cli` and `@opencode/cli-node`) whose `optionalDependencies` list the platform packages and whose `postinstall` script (`packages/cli/script/postinstall.mjs`) links/copies the matching platform binary.
  - Library packages (`@opencode/ai`, `@opencode/schema`, `@opencode/protocol`, `@opencode/core`, `@opencode/server`, `@opencode/client`, `@opencode/sdk`, `@opencode/plugin`, `@opencode/theme`, `@opencode/util`, `@opencode/codemode`) are packed via root `script/pack.ts` (`bun run pack`).
- **Install script**:
  - Root `install` (served at `https://opencode.ai/v2/install`): Bash script that detects OS, arch (including Rosetta and Windows ARM64 emulation), musl vs glibc, and AVX2 support; queries `https://opencode.ai/update/api/latest/cli/npm` for the latest version/package scope; downloads the npm platform tarball `https://registry.npmjs.org/@opencode/cli-<target>/-/cli-<target>-<version>.tgz`; extracts the binary to `$HOME/.opencode/bin/opencode[.exe]` plus a legacy `opencode2` shim; and adds `$HOME/.opencode/bin` to the user's shell config (`~/.zshrc`, `~/.bashrc`, `config.fish`, etc.). Note: there is no `install.ps1` in this repo (Windows uses Git Bash with `install`, WinGet `Anomaly.OpenCode`, or npm).

---

## 12. User-Visible "opencode" / "OpenCode" Branding and Network Calls to OpenCode Servers

### A. User-Visible Places "opencode" / "OpenCode" Appears (Terminal, CLI, Core, Extension)

- **ASCII logo and splash**:
  - `packages/tui/src/logo.ts` (large block-letter `opencode` and `go` ASCII art rendered on home screen via `packages/tui/src/component/logo.tsx` and `packages/tui/src/routes/home.tsx`).
  - `install` lines 505-519 (ASCII banner, `"OpenCode includes free models"`, `https://opencode.ai/docs`).
  - `packages/tui/src/mini/splash.ts` (`opencode mini -s <id>`).
- **CLI command names, help text, and messages**:
  - `packages/cli/package.json` (`bin`: `opencode`, `opencode2`), `packages/cli/bin/opencode.cjs` (error message naming `@opencode/cli-*`).
  - `packages/cli/src/commands/commands.ts` (root command name `"opencode"`, `"OpenCode command line interface"`, `"Directory to start OpenCode in"`, `"Upgrade OpenCode..."`, `"Uninstall OpenCode..."`, `"Run OpenCode with a message"`).
  - `packages/cli/src/commands/handlers/{default,upgrade,uninstall,acp,stats,pair,mcp/auth,machine/common}.ts` and `packages/cli/src/server-process.ts`, `packages/cli/src/services/{updater,update-preflight,service-config,remote-tunnel}.ts`, `packages/cli/src/mini.ts`, `packages/cli/src/mini-host.ts` (usage strings, upgrade/uninstall prompts, `"Loading OpenCode"`, `"OpenCode update could not start..."`, `opencode service ...` hints).
- **TUI chrome, dialogs, copy, and notifications**:
  - Terminal title and desktop/attention notifications: `packages/tui/src/app.tsx`, `packages/tui/src/attention.ts` (`"OpenCode"`), `packages/tui/src/mini/runtime.lifecycle.ts`.
  - Docs/help links and error screen: `packages/tui/src/app.tsx` (`https://opencode.ai/docs`), `packages/tui/src/component/error-component.tsx` (`OpenCode <version>`, GitHub bug report link), `packages/tui/src/util/error-details.ts`, `packages/tui/src/util/error.ts` (`opencode models`), `packages/tui/src/util/presentation.ts` (`Run opencode to use ...`).
  - Free-model and Go upsell UI: `packages/tui/src/feature-plugins/sidebar/footer.tsx` (`"OpenCode includes free models..."`), `packages/tui/src/component/dialog-go-upsell.tsx` (`"OpenCode Go..."`, `https://opencode.ai/go`), `packages/tui/src/component/usage.tsx`, `packages/tui/src/util/usage-limits.ts` (`https://opencode.ai/console/...`), `packages/tui/src/component/dialog-integration.tsx` (`opencode` / `opencode-go` ordering).
  - Update, pairing, permission, and stats UI: `packages/tui/src/component/dialog-update.tsx` (`"Updating OpenCode"`), `packages/tui/src/component/dialog-pair.tsx`, `packages/tui/src/component/terminal-pane.tsx`, `packages/tui/src/routes/session/permission.tsx` & `packages/tui/src/mini/footer.permission.tsx` (`"Tell OpenCode what to do differently"`), `packages/tui/src/mini/footer.prompt.tsx` (`"close OpenCode"`), `packages/tui/src/feature-plugins/system/stats.tsx` (`opencode.ai`), `packages/tui/src/config/index.tsx` (release highlights description), `packages/tui/src/theme/index.ts` (theme names `"opencode"` and `"opencode-classic"`).
- **Agent prompts, built-in skills, and tool/error text**:
  - `packages/core/src/session/runner/prompt/system.txt` (`"You are an AI agent running in OpenCode..."`).
  - `packages/core/src/plugin/skill/opencode.md` (built-in skill pointing to `https://opencode.ai/docs/*`).
  - `packages/core/src/plugin/provider/opencode.ts`, `opencode-artifacts.ts`, `opencode-watches.ts`, `packages/core/src/voice.ts`, `packages/core/src/usage-limits.ts` (`"OpenCode"`, `"OpenCode Console"`, `"OpenCode account"`, `"OpenCode Web Search"`).
  - `packages/core/src/plugin/provider/{openrouter,kilo,llmgateway,nvidia,zenmux}.ts` (sends `HTTP-Referer: https://opencode.ai/` and `X-Title: opencode` headers to third-party routers).
- **VS Code extension**:
  - `sdks/vscode/package.json` (`name`/`displayName`: `"opencode"`, commands `"Open opencode"`, `"Open opencode in new tab"`, keybinding titles `"Run opencode"`, `"opencode: Insert At-Mentioned"`).
  - `sdks/vscode/src/extension.ts` (`TERMINAL_NAME = "opencode"`, `OPENCODE_CALLER: "vscode"`, `terminal.sendText("opencode")`).
- **File paths and database/config names**:
  - `~/.config/opencode`, `~/.local/share/opencode/opencode.db`, `~/.opencode/bin/opencode`, `.opencode/`, `opencode.json`, `opencode.jsonc`, `User-Agent: opencode/...` (`packages/cli/script/build.ts`, `packages/core/src/app.ts`).

### B. Every Network Call to OpenCode's Own Servers (Must Be Removed or Replaced for Pendix)

| Category | File Path(s) | Endpoint / Target | Trigger |
| --- | --- | --- | --- |
| **Update checks & self-upgrade** | `packages/cli/src/services/updater.ts` (L324, L542); `install` (L179) | `https://opencode.ai/update/api/<channel>/<artifact>/<dist>?current=<version>` and `https://opencode.ai/v2/install` (plus `https://formulae.brew.sh/api/formula/opencode.json` for brew) | Every 10 minutes while TUI runs (`packages/cli/src/commands/handlers/default.ts` L98) unless `OPENCODE_LOCAL` or `OPENCODE_DISABLE_AUTOUPDATE=true`, plus `opencode upgrade` and `install` script. |
| **Models.dev catalog mirror** | `packages/core/src/models-dev.ts` (L648, L651) | `https://models.opencode.ai/experimental/v2.0/api.json?type=...&include=...` | On server boot and every 5 minutes unless `OPENCODE_DISABLE_MODELS_FETCH=true` or `OPENCODE_MODELS_URL` is pointed at `https://models.dev` (or Pendix mirror). |
| **Paid & free model gateways (Zen / Go / Inference)** | `packages/core/src/models-dev/snapshot.txt` (`opencode`, `opencode-go` providers); `packages/core/src/plugin/provider/opencode.ts` (L481-507) | `https://opencode.ai/inference/{anthropic,google,minimax,openai,systemone,xai}/v1*` and `https://opencode.ai/inference/go/{anthropic,google,openai}/v1*` | Whenever a user selects a model under `opencode` (enabled by default with `apiKey: "public"` for free models) or `opencode-go`. |
| **OpenCode Console account, config, skills, instructions, web search** | `packages/core/src/console-access.ts` (L5, L12); `packages/core/src/plugin/provider/opencode.ts` | `https://opencode.ai/console` (rewrites `console.opencode.ai`): `/auth/device/code`, `/auth/device/token`, `/auth/sso/<id>/start`, `/api/user`, `/api/orgs`, `/api/v2/config`, `/api/v2/instructions`, `/api/v2/skills`, `/api/v2/skills/<slug>`, `/api/websearch` | OAuth login to `"opencode"` integration; once connected, polls `/api/v2/config` every 1 minute. |
| **OpenCode Go / Console usage limits** | `packages/core/src/usage-limits.ts` (L109, L164) | `https://opencode.ai/console/api/policies/current-budgets` and `https://opencode.ai/zen/go/v1/usage` | When checking usage limits while connected to OpenCode Console. |
| **Console artifacts sharing (share links)** | `packages/core/src/plugin/provider/opencode-artifacts.ts` (L55-131) | `https://opencode.ai/console/api/artifacts/*` | When connected to Console with artifacts enabled. (Legacy V1 session `share_url` column exists in `packages/core/src/session/sql.ts`, and `OPENCODE_DISABLE_SHARE` remains in `turbo.json`, but V2 has no active `share.opencode.ai` client in `packages/core`.) |
| **Console event watches** | `packages/core/src/plugin/provider/opencode-watches.ts` (L503, L558-616) | `wss://opencode.ai/console/api/event-watches/stream` and `/api/event-watches/*` | When connected to Console with `console_watches` flag enabled. |
| **Hosted realtime voice (GPT-Live)** | `packages/core/src/voice.ts` (L167) | `https://opencode.ai/inference/openai/v1` | Starting a `gpt-live` voice session via OpenCode Console credentials. |
| **MCP OAuth client metadata** | `packages/core/src/mcp/oauth.ts` (L36, L168-169) | `https://opencode.ai/oauth/opencode/client.json`, `https://opencode.ai`, `https://opencode.ai/web-app-manifest-512x512.png` | Dynamic client registration / OAuth metadata for remote MCP servers. |
| **Remote access tunnel (`opencode pair --remote`)** | `packages/cli/src/services/remote-tunnel.ts` | `@opentunnel/client` service | Only when user enables `service set remote true` or `opencode pair --remote`. |
| **Telemetry / Observability / Crash reporting** | `packages/util/src/observability.ts`, `packages/util/src/observability/otlp.ts`; `packages/app/src/entry.tsx`, `packages/desktop/src/renderer/startup/sentry.ts` | OTLP (`OTEL_EXPORTER_OTLP_ENDPOINT/v1/{logs,traces}`) and Sentry (`VITE_SENTRY_DSN` in web/desktop only) | Both are off by default unless those env vars are explicitly set. No PostHog or hidden phone-home telemetry exists in CLI/core/server. |
| **Other non-OpenCode default external fetches to be aware of** | `packages/core/src/plugin/websearch/exa.ts` (L9); `packages/tui/src/parsers-config.ts` (L171-255) | `https://mcp.exa.ai/mcp` (default web search tool); `github.com/anomalyco/tree-sitter-{vue,clojure}` (lazy tree-sitter grammar downloads) | On `websearch` tool calls (Exa) or highlighting Vue/Clojure files in TUI. |

---

## 13. Folders Pendix Will Not Ship and Can Ignore

Per `SPEC.md` (S1, S3: terminal app, editor extension, MCP server/hooks, Pendix's own web dashboard and cloud backend; no desktop app):

- **Desktop app & GUI plugins**:
  - `packages/desktop/` (OpenCode Electron desktop app)
  - `packages/gui-plugins/` (desktop/web GUI plugins: SSH, WSL, embedded browser, desktop updater, pairing)
  - `packages/plugin-browser/` (desktop CDP browser automation plugin)
  - `packages/plugins/figma/` (OpenCode's bundled Figma plugin)
- **OpenCode's web app, design system, and Storybook**:
  - `packages/app/` (OpenCode web UI)
  - `packages/ui/` (OpenCode web UI component kit)
  - `packages/session-ui/` (OpenCode web session UI)
  - `packages/stories/` (Playwright component stories for `packages/app` and `packages/session-ui`)
  - `packages/nav-menus/` (OpenCode web nav/branding)
  - `packages/identity/` (OpenCode brand SVGs/PNGs)
- **OpenCode's hosted websites, data/analytics site, and Cloudflare services**:
  - `packages/data/` (`packages/data/app`, `packages/data/core`, `packages/data/server` - `opencode.ai/data` analytics site and R2/PlanetScale sync)
  - `services/site/` (`opencode.ai` site and docs)
  - `services/data/` (Cloudflare deployment for `packages/data`)
  - `services/files/` (OpenCode release file host)
  - `services/update/` (OpenCode update API Worker)
  - `services/legacy/` (deprecated `opncd.ai` / `api.opencode.ai` Worker)
- **Other unshipped upstream folders**:
  - `packages/cli-rs/` (unshipped Rust CLI/TUI rewrite)
  - `packages/effect-drizzle-sqlite/` (standalone examples only)
  - `salesforce/` (upstream Salesforce app)
  - `nix/`, `flake.nix`, `flake.lock` (OpenCode Nix derivations; not part of Pendix's S24 distribution)
  - Note: OpenCode's closed-source web Console and billing backend do not live in this repository (only client integration code lives in `packages/core/src/console-access.ts`, `packages/core/src/plugin/provider/opencode*.ts`, and `packages/core/src/usage-limits.ts`, which Pendix should disable/strip).
