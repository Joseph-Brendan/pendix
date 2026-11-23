import type { FileSystem } from "@pendix/core/filesystem"
import { Bus } from "@pendix/core/bus"
import { Image } from "@pendix/core/image"
import { LocationServiceMap } from "@pendix/core/location-service-map"
import type { LocationServices } from "@pendix/core/location-services"
import { Plugin } from "@pendix/core/plugin"
import { PluginHooks } from "@pendix/core/plugin/hooks"
import { Skill } from "@pendix/core/skill"
import type { Location } from "@pendix/schema/location"
import { makeGlobalNode } from "@pendix/util/effect/app-node"
import { LayerNode } from "@pendix/util/effect/layer-node"
import { Effect, Layer, LayerMap } from "effect"

// Plain-prompt unit fixtures use virtual directories.
export const promptLocationNode = makeGlobalNode({
  service: LocationServiceMap.Service,
  layer: Layer.effect(
    LocationServiceMap.Service,
    Effect.gen(function* () {
      const bus = yield* Bus.Service
      return yield* LayerMap.make(
        (_ref: Location.Ref) =>
          LayerNode.compile(LayerNode.group([PluginHooks.node, Image.node, Skill.node, Plugin.node]), {
            replacements: [
              Bus.node.replace(Layer.succeed(Bus.Service, bus)),
              Plugin.node.replace(Layer.mock(Plugin.Service, { awaitActivation: Effect.void })),
            ],
          }) as unknown as Layer.Layer<LocationServices, FileSystem.DirectoryNotFoundError>,
      )
    }),
  ),
  deps: [Bus.node],
})
