import { describe, expect } from "bun:test"
import { Bus } from "@pendix/core/bus"
import { Database } from "@pendix/core/database/database"
import { AppNodeBuilder } from "@pendix/core/effect/app-node-builder"
import { EventTable } from "@pendix/core/event/sql"
import { Location } from "@pendix/core/location"
import { Project } from "@pendix/core/project"
import { AbsolutePath } from "@pendix/core/schema"
import { Session } from "@pendix/core/session"
import { SessionEvent } from "@pendix/core/session/event"
import { SessionExecution } from "@pendix/core/session/execution"
import { SessionProjector } from "@pendix/core/session/projector"
import { SessionStore } from "@pendix/core/session/store"
import { LayerNode } from "@pendix/util/effect/layer-node"
import { Effect } from "effect"
import { eq } from "drizzle-orm"
import { testEffect } from "./lib/effect"
import { globalProjectNode } from "./lib/project"

const it = testEffect(
  AppNodeBuilder.build(
    LayerNode.group([Database.node, Bus.node, SessionProjector.node, SessionStore.node, Session.node]),
    [
      Bus.node.replace(Bus.configured({ persist: true })),
      Project.node.replace(globalProjectNode),
      SessionExecution.node.replace(SessionExecution.noopLayer),
    ],
  ),
)
const location = Location.Ref.make({ directory: AbsolutePath.make("/project") })

describe("Session.archive", () => {
  it.effect("archives and unarchives through one durable event each", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const { db } = yield* Database.Service
      const created = yield* session.create({ location })
      expect(created.time.archived).toBeUndefined()

      yield* session.archive(created.id)
      yield* session.archive(created.id)
      expect((yield* session.get(created.id)).time.archived).toBeDefined()

      yield* session.unarchive(created.id)
      yield* session.unarchive(created.id)
      expect((yield* session.get(created.id)).time.archived).toBeUndefined()

      const types = (yield* db
        .select({ type: EventTable.type })
        .from(EventTable)
        .where(eq(EventTable.aggregate_id, created.id))
        .all()).map((event) => event.type)
      expect(types.filter((type) => type === Bus.versionedType(SessionEvent.Archived.type, 1))).toHaveLength(1)
      expect(types.filter((type) => type === Bus.versionedType(SessionEvent.Unarchived.type, 1))).toHaveLength(1)
    }),
  )

  it.effect("filters listed sessions by archive state", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const active = yield* session.create({ location })
      const archived = yield* session.create({ location })
      yield* session.archive(archived.id)

      const ids = (input?: Session.ListInput) =>
        session.list(input).pipe(Effect.map((page) => page.data.map((item) => item.id).toSorted()))
      expect(yield* ids()).toEqual([active.id, archived.id].toSorted())
      expect(yield* ids({ archived: false })).toEqual([active.id])
      expect(yield* ids({ archived: true })).toEqual([archived.id])
    }),
  )

  it.effect("rejects an unknown session", () =>
    Effect.gen(function* () {
      const session = yield* Session.Service
      const sessionID = Session.ID.make("ses_missing_archive")
      expect(yield* Effect.flip(session.archive(sessionID))).toEqual(new Session.NotFoundError({ sessionID }))
      expect(yield* Effect.flip(session.unarchive(sessionID))).toEqual(new Session.NotFoundError({ sessionID }))
    }),
  )
})
