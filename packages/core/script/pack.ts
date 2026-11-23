#!/usr/bin/env bun
import path from "node:path"
import { pack } from "@pendix/script/pack"

await pack(path.resolve(import.meta.dir, ".."), { types: "./dist/types/" })
