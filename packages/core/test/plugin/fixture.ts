import { Agent } from "@pendix/core/agent"
import { App } from "@pendix/core/app"
import { Artifact } from "@pendix/core/artifact"
import { BlobStore } from "@pendix/core/blob-store"
import { AISDK } from "@pendix/core/aisdk"
import { Automation } from "@pendix/core/automation"
import { Command } from "@pendix/core/command"
import { Config } from "@pendix/core/config"
import { Credential } from "@pendix/core/credential"
import { Database } from "@pendix/core/database/database"
import { Environment } from "@pendix/core/environment/index"
import { FileAccess } from "@pendix/core/file-access"
import { Flag } from "@pendix/core/flag"
import { LayerNodePlatform } from "@pendix/util/effect/app-node-platform"
import { AppProcess } from "@pendix/util/process"
import { LayerNode } from "@pendix/util/effect/layer-node"
import { Bus } from "@pendix/core/bus"
import { FileSystem } from "@pendix/core/filesystem"
import { FSUtil } from "@pendix/util/fs-util"
import { Global } from "@pendix/util/global"
import { Form } from "@pendix/core/form"
import { Generate } from "@pendix/core/generate"
import { InstructionDiscovery } from "@pendix/core/instruction-discovery"
import { Integration } from "@pendix/core/integration"
import { Job } from "@pendix/core/job"
import { KV } from "@pendix/core/kv"
import { Location } from "@pendix/core/location"
import { Mcp } from "@pendix/core/mcp/index"
import { Model } from "@pendix/core/model"
import { ModelsDev } from "@pendix/core/models-dev"
import { Npm } from "@pendix/util/npm"
import { Plugin } from "@pendix/core/plugin"
import { PluginHooks } from "@pendix/core/plugin/hooks"
import { Provider } from "@pendix/core/provider"
import { Session } from "@pendix/core/session"
import { SharedCache } from "@pendix/core/shared-cache"
import { InstructionEntry } from "@pendix/core/session/instruction-entry"
import { PersistentPty } from "@pendix/core/persistent-pty"
import { LocationServiceMap } from "@pendix/core/location-service-map"
import { AppNodeBuilder } from "@pendix/core/effect/app-node-builder"
import { Permission } from "@pendix/core/permission"
import { Reference } from "@pendix/core/reference"
import { Rpc } from "@pendix/core/rpc"
import { Skill } from "@pendix/core/skill"
import { SkillDiscovery } from "@pendix/core/skill/discovery"
import { Watcher } from "@pendix/core/filesystem/watcher"
import { Tool } from "@pendix/core/tool"
import { Vcs } from "@pendix/core/vcs"
import { VideoGeneration } from "@pendix/core/video-generation"
import { WebSearch } from "@pendix/core/websearch"
import { Worktree } from "@pendix/core/worktree"
import { WorktreeStrategies } from "@pendix/core/worktree/strategies"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"
import { emptyMcpLayer } from "../fixture/mcp"
import { offlineModels } from "../fixture/models"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: (name) => Effect.succeed({ directory: "", name }),
    resolve: (name) => Effect.succeed({ directory: "", name }),
    check: () => Effect.succeed(false),
    update: (name) => Effect.succeed({ directory: "", name }),
    follows: () => Effect.succeed(false),
    reject: () => Effect.succeed(false),
    which: () => Effect.undefined,
  }),
)

const generateLayer = Layer.succeed(
  Generate.Service,
  Generate.Service.of({
    text: () => Effect.succeed(""),
    image: () => Effect.die("unused"),
    decisions: () => Effect.die("unused"),
    video: {
      start: () => Effect.die("unused"),
      status: () => Effect.die("unused"),
      result: () => Effect.die("unused"),
      cancel: () => Effect.die("unused"),
    },
  }),
)

const configLayer = Config.testLayer()

const permissionLayer = Layer.succeed(
  Permission.Service,
  Permission.Service.of({
    close: Effect.void,
    ask: (input) => Effect.succeed({ id: input.id ?? Permission.ID.create(), effect: "ask" }),
    assert: () => Effect.void,
    assertNotDenied: () => Effect.void,
    allows: () => Effect.succeed(false),
    reply: () => Effect.void,
    get: () => Effect.succeed(undefined),
    forSession: () => Effect.succeed([]),
    list: () => Effect.succeed([]),
    nested: () => Effect.void,
  }),
)

export const makePluginTestLayer = (
  permission = permissionLayer,
  generate = generateLayer,
  replacements: LayerNode.Replacements = [],
) =>
  AppNodeBuilder.build(
    LayerNode.group([
      App.node,
      AppProcess.node,
      FileSystem.node,
      FSUtil.node,
      Location.node,
      Npm.node,
      Credential.node,
      Config.node,
      Flag.node,
      Database.node,
      Environment.node,
      FileAccess.node,
      Global.node,
      Bus.node,
      Form.node,
      Generate.node,
      LayerNodePlatform.httpClient,
      Plugin.node,
      Agent.node,
      Artifact.node,
      AISDK.node,
      Automation.node,
      BlobStore.node,
      Provider.node,
      Model.node,
      ModelsDev.node,
      Command.node,
      InstructionDiscovery.node,
      Integration.node,
      Job.node,
      KV.node,
      Mcp.node,
      Session.node,
      SharedCache.node,
      InstructionEntry.node,
      PersistentPty.node,
      LocationServiceMap.node,
      Permission.node,
      PluginHooks.node,
      Reference.node,
      Rpc.node,
      Skill.node,
      SkillDiscovery.node,
      Tool.node,
      Vcs.node,
      VideoGeneration.node,
      Watcher.node,
      WebSearch.node,
      Worktree.node,
      WorktreeStrategies.node,
    ]),
    [
      Location.node.replace(tempLocationLayer),
      Npm.node.replace(npmLayer),
      Config.node.replace(configLayer),
      Mcp.node.replace(emptyMcpLayer),
      Generate.node.replace(generate),
      Permission.node.replace(permission),
      offlineModels,
      ...replacements,
    ],
  ).pipe(Layer.provideMerge(configLayer))

export const PluginTestLayer = makePluginTestLayer()
