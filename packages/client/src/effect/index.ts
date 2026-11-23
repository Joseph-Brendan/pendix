// TODO: Keep additional network capabilities inside Schema and Protocol as the client grows; /effect must never import
// Core or Server. Preserve these datatype exports so internal model reorganizations do not require caller migrations.
import type { Effect } from "effect"
import type { OpenCode } from "./client.js"

export * from "./generated/index"
export { OpenCode } from "./client.js"
export type {
  AgentApi,
  AppApi,
  CommandApi,
  ConfigApi,
  EventApi,
  IntegrationApi,
  ModelApi,
  PluginApi,
  ProviderApi,
  ReferenceApi,
  RpcApi,
  RpcClient,
  WebSearchApi,
  SessionApi,
  SkillApi,
} from "./api.js"
export { Agent } from "@pendix/schema/agent"
export { Command } from "@pendix/schema/command"
export { Config } from "@pendix/schema/config"
export { Credential } from "@pendix/schema/credential"
export { Event } from "@pendix/schema/event"
export { EventLog } from "@pendix/schema/event-log"
export { FileSystem } from "@pendix/schema/filesystem"
export { Form } from "@pendix/schema/form"
export { Integration } from "@pendix/schema/integration"
export { Location } from "@pendix/schema/location"
export { Model } from "@pendix/schema/model"
export { Permission } from "@pendix/schema/permission"
export { PermissionSaved } from "@pendix/schema/permission-saved"
export { Project } from "@pendix/schema/project"
export { Worktree } from "@pendix/schema/worktree"
export { Vcs } from "@pendix/schema/vcs"
export { Provider } from "@pendix/schema/provider"
export { Pty } from "@pendix/schema/pty"
export { Question } from "@pendix/schema/question"
export { Reference } from "@pendix/schema/reference"
export { WebSearch } from "@pendix/schema/websearch"
export { AbsolutePath, RelativePath } from "@pendix/schema/schema"
export { Session } from "@pendix/schema/session"
export { SessionInbox } from "@pendix/schema/session-inbox"
export { SessionMessage } from "@pendix/schema/session-message"
export { Skill } from "@pendix/schema/skill"
export { Prompt } from "@pendix/schema/prompt"
export { PromptInput } from "@pendix/schema/prompt-input"
export type { OpenCodeEvent } from "@pendix/protocol/groups/event"
export type OpenCodeClient = Effect.Success<ReturnType<typeof OpenCode.make>>
