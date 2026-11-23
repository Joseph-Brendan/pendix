import { NodeFileSystem } from "@effect/platform-node"
import { compile, emitEffectImported, emitEffectShape, emitPromise, write } from "@pendix/httpapi-codegen"
import {
  ClientApi,
  clientNamespace,
  deprecatedClientPaths,
  effectOmitEndpoints,
  groupNames,
  promiseOmitEndpoints,
} from "@pendix/protocol/client"
import { Agent } from "@pendix/schema/agent"
import { Artifact } from "@pendix/schema/artifact"
import { Automation } from "@pendix/schema/automation"
import { Command } from "@pendix/schema/command"
import { Config } from "@pendix/schema/config"
import { Credential } from "@pendix/schema/credential"
import { Event } from "@pendix/schema/event"
import { EventLog } from "@pendix/schema/event-log"
import { FileDiff } from "@pendix/schema/file-diff"
import { FileSystem } from "@pendix/schema/filesystem"
import { Form } from "@pendix/schema/form"
import { Generate } from "@pendix/schema/generate"
import { Instruction } from "@pendix/schema/instruction"
import { InstructionEntry } from "@pendix/schema/instruction-entry"
import { Integration } from "@pendix/schema/integration"
import { Job } from "@pendix/schema/job"
import { Location } from "@pendix/schema/location"
import { Mcp } from "@pendix/schema/mcp"
import { Model } from "@pendix/schema/model"
import { Money } from "@pendix/schema/money"
import { Permission } from "@pendix/schema/permission"
import { PermissionSaved } from "@pendix/schema/permission-saved"
import { Plugin } from "@pendix/schema/plugin"
import { Project } from "@pendix/schema/project"
import { Worktree } from "@pendix/schema/worktree"
import { AgentAttachment, FileAttachment, Prompt, PromptMention } from "@pendix/schema/prompt"
import { PromptInput } from "@pendix/schema/prompt-input"
import { Provider } from "@pendix/schema/provider"
import { Pty } from "@pendix/schema/pty"
import { PtyTicket } from "@pendix/schema/pty-ticket"
import { Question } from "@pendix/schema/question"
import { Reference } from "@pendix/schema/reference"
import { AbsolutePath, RelativePath } from "@pendix/schema/schema"
import { Session } from "@pendix/schema/session"
import { SessionMessage } from "@pendix/schema/session-message"
import { SessionInbox } from "@pendix/schema/session-inbox"
import { Shell } from "@pendix/schema/shell"
import { Skill } from "@pendix/schema/skill"
import { Snapshot } from "@pendix/schema/snapshot"
import { UsageLimits } from "@pendix/schema/usage-limits"
import { Vcs } from "@pendix/schema/vcs"
import { WebSearch } from "@pendix/schema/websearch"
import { Workspace } from "@pendix/schema/workspace"
import { Effect, Schema } from "effect"
import { fileURLToPath } from "url"

const promiseContract = compile(ClientApi, {
  groupNames,
  omitEndpoints: promiseOmitEndpoints,
  namespace: clientNamespace,
  aliases: deprecatedClientPaths,
})
const effectContract = compile(ClientApi, {
  groupNames,
  omitEndpoints: effectOmitEndpoints,
  namespace: clientNamespace,
  aliases: deprecatedClientPaths,
})
const effectTypeReferences = [
  ...namespaceTypes("Agent", "@pendix/schema/agent", Agent),
  ...namespaceTypes("Artifact", "@pendix/schema/artifact", Artifact),
  ...namespaceTypes("Automation", "@pendix/schema/automation", Automation),
  ...namespaceTypes("Command", "@pendix/schema/command", Command),
  ...namespaceTypes("Config", "@pendix/schema/config", Config),
  ...namespaceTypes("Credential", "@pendix/schema/credential", Credential),
  ...namespaceTypes("Event", "@pendix/schema/event", Event),
  ...namespaceTypes("EventLog", "@pendix/schema/event-log", EventLog),
  ...namespaceTypes("FileDiff", "@pendix/schema/file-diff", FileDiff),
  ...namespaceTypes("FileSystem", "@pendix/schema/filesystem", FileSystem),
  ...namespaceTypes("Form", "@pendix/schema/form", Form),
  ...namespaceTypes("Generate", "@pendix/schema/generate", Generate),
  ...namespaceTypes("Instruction", "@pendix/schema/instruction", Instruction),
  ...namespaceTypes("InstructionEntry", "@pendix/schema/instruction-entry", InstructionEntry),
  ...namespaceTypes("Integration", "@pendix/schema/integration", Integration),
  ...namespaceTypes("Job", "@pendix/schema/job", Job),
  typeReference("Location.PublicRef", "@pendix/schema/location", Location.PublicRef),
  typeReference("Location.PublicInfo", "@pendix/schema/location", Location.PublicInfo),
  ...namespaceTypes("Mcp", "@pendix/schema/mcp", Mcp),
  ...namespaceTypes("Model", "@pendix/schema/model", Model),
  ...namespaceTypes("Money", "@pendix/schema/money", Money),
  ...namespaceTypes("Permission", "@pendix/schema/permission", Permission),
  ...namespaceTypes("PermissionSaved", "@pendix/schema/permission-saved", PermissionSaved),
  ...namespaceTypes("Plugin", "@pendix/schema/plugin", Plugin),
  ...namespaceTypes("Project", "@pendix/schema/project", Project),
  ...namespaceTypes("Worktree", "@pendix/schema/worktree", Worktree),
  ...namespaceTypes("PromptInput", "@pendix/schema/prompt-input", PromptInput),
  ...namespaceTypes("Provider", "@pendix/schema/provider", Provider),
  ...namespaceTypes("Pty", "@pendix/schema/pty", Pty),
  ...namespaceTypes("PtyTicket", "@pendix/schema/pty-ticket", PtyTicket),
  ...namespaceTypes("Question", "@pendix/schema/question", Question),
  ...namespaceTypes("Reference", "@pendix/schema/reference", Reference),
  ...namespaceTypes("Session", "@pendix/schema/session", Session),
  ...namespaceTypes("SessionMessage", "@pendix/schema/session-message", SessionMessage),
  ...namespaceTypes("SessionInbox", "@pendix/schema/session-inbox", SessionInbox),
  ...namespaceTypes("Shell", "@pendix/schema/shell", Shell),
  ...namespaceTypes("Skill", "@pendix/schema/skill", Skill),
  ...namespaceTypes("Snapshot", "@pendix/schema/snapshot", Snapshot),
  ...namespaceTypes("UsageLimits", "@pendix/schema/usage-limits", UsageLimits),
  ...namespaceTypes("Vcs", "@pendix/schema/vcs", Vcs),
  ...namespaceTypes("WebSearch", "@pendix/schema/websearch", WebSearch),
  ...namespaceTypes("Workspace", "@pendix/schema/workspace", Workspace),
  typeReference("Prompt", "@pendix/schema/prompt", Prompt),
  typeReference("PromptMention", "@pendix/schema/prompt", PromptMention),
  typeReference("FileAttachment", "@pendix/schema/prompt", FileAttachment),
  typeReference("AgentAttachment", "@pendix/schema/prompt", AgentAttachment),
  typeReference("AbsolutePath", "@pendix/schema/schema", AbsolutePath),
  typeReference("RelativePath", "@pendix/schema/schema", RelativePath),
]

await Effect.runPromise(
  Effect.all(
    [
      write(
        emitPromise(promiseContract, {
          mutableOutputs: true,
        }),
        fileURLToPath(new URL("../src/promise/generated", import.meta.url)),
      ),
      write(
        emitEffectImported(effectContract, {
          module: "../../contract",
          api: "ClientApi",
          shapeModule: "../api/api.js",
        }),
        fileURLToPath(new URL("../src/effect/generated", import.meta.url)),
      ),
      write(
        emitEffectShape(effectContract, {
          typeReferences: effectTypeReferences,
          outputTypes: {
            "event.subscribe": {
              name: "OpenCodeEvent",
              import: 'import type { OpenCodeEvent } from "@pendix/protocol/groups/event"',
            },
          },
        }),
        fileURLToPath(new URL("../src/effect/api", import.meta.url)),
      ),
    ],
    { concurrency: 3, discard: true },
  ).pipe(Effect.provide(NodeFileSystem.layer)),
)

function namespaceTypes(namespace: string, module: string, values: object) {
  return Object.entries(values).flatMap(([name, schema]) =>
    Schema.isSchema(schema) ? [typeReference(`${namespace}.${name}`, module, schema)] : [],
  )
}

function typeReference(name: string, module: string, schema: Schema.Top) {
  return {
    schema,
    name,
    import: `import type { ${name.split(".")[0]} } from ${JSON.stringify(module)}`,
  }
}
