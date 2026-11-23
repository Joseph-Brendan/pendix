# Pendix

Use this guide as the starting point for work involving Pendix itself. It covers
the core concepts needed to configure and customize Pendix, manage MCP servers,
run the background service, and troubleshoot issues.

## CLI

CLI and TUI preferences are separate from Pendix server and project
configuration. They live in `~/.config/pendix/cli.json`, or
`$XDG_CONFIG_HOME/pendix/cli.json` when `XDG_CONFIG_HOME` is set. Most
preferences can also be changed from the TUI by pressing `Ctrl+P` and selecting
**Open settings**.

### Keybinds

Configure keybindings under `keybinds` in `cli.json`. The leader key is
`keybinds.leader`. Leader timing is configured under `leader.timeout`. Disable
a binding with `"none"` or `false`.

## Configuration

Pendix server and project configuration uses JSON or JSONC.

Global configuration lives at `~/.config/pendix/pendix.json(c)` and applies to
every project for that user. Project configuration can live in any directory as
`pendix.json(c)` or `.pendix/pendix.json(c)`, including nested packages in a
monorepo.

During project discovery, Pendix searches the current directory and every
ancestor through the filesystem root. It merges direct `pendix.json(c)` files
from the farthest ancestor to the current directory, then does the same for
`.pendix/pendix.json(c)` files. Global filesystem configuration has lower
precedence than discovered project documents.

Common configuration fields include `model`, `default_agent`, `permissions`,
`agents`, `commands`, `plugins`, `providers`, `mcp`, `skills`, `instructions`,
`references`, `formatter`, and `lsp`.

Config changes apply without a restart. Pendix watches config files and reloads
agents, commands, skills, MCP servers, and plugins after a save. The TUI does
the same for `cli.json`. To force a full reload, use `/reload`.

## MCP servers

Configure MCP servers under `mcp.servers`. Prefer the CLI because it preserves
unrelated configuration. Use `--global` to add a server across all projects.

```sh
pendix mcp add <name> --global --url <remote-url>
pendix mcp list
```

Remote servers use OAuth by default. If `mcp list` reports that a server needs
authentication, tell the user to run `/mcps`, select the server, and sign in.
Do not run `pendix mcp auth` through the shell tool.

## Service

Pendix uses a client-server architecture. Interfaces such as the TUI connect to
a background Pendix service, which owns sessions, configuration, plugins,
permissions, and tool execution.

Pendix discovers or starts the shared background service automatically. Restart
it only if it is stuck or unhealthy, not to apply configuration changes:

```sh
pendix service restart
pendix service status
```

## API

Pendix exposes an HTTP API from its server. The API is described by an OpenAPI
document available from the running server at `/openapi.json`.

Call an endpoint with an HTTP method and path:

```sh
pendix api get /api/info
```

## Troubleshooting

Start by checking whether a problem belongs to the client, the shared server,
or one project.

- Check the service with `pendix service status` and verify the API with
  `pendix api get /api/info`.
- Compare with `pendix --standalone`, which runs the TUI with a private server.
- Inspect `~/.local/share/pendix/log/pendix.log`.
- Do not delete or edit the database, service registration, or service config
  while diagnosing a problem.
- Redact API keys, authorization headers, prompts, file contents, and other
  sensitive data before sharing diagnostics.
