import type { GraderModelSpec } from "@pendix/shared/models"
import type { LanguageModel } from "ai"
import { MockLanguageModelV4 } from "ai/test"
import type { BatchGradeOutput } from "./schemas.js"

export interface FakeModelCall {
  readonly spec: GraderModelSpec
  readonly system: string
  readonly prompt: string
  readonly abortSignal?: AbortSignal
  readonly attempt: number
}

export type FakeModelHandler = (call: FakeModelCall) => unknown | Promise<unknown>

export interface FakeModelOptions {
  readonly onGenerate?: FakeModelHandler
  readonly responses?: readonly unknown[]
}

interface ParsedBatchPayload {
  readonly prompt_indices?: number[]
  readonly include_session_summary?: boolean
  readonly session_overview?: {
    readonly project_name?: string
    readonly teach_qa?: readonly { readonly question: string; readonly answer: string }[]
  }
}

function parseBatchPayloadFromPrompt(prompt: string): ParsedBatchPayload {
  const marker = "Session batch data (JSON):\n"
  const idx = prompt.indexOf(marker)
  if (idx === -1) return {}
  const afterMarker = prompt.slice(idx + marker.length)
  // If a validation retry appended text after the JSON block, extract the JSON object cleanly.
  const retryMarker = "\n\nYour previous response failed structured output validation"
  const jsonText = afterMarker.includes(retryMarker)
    ? afterMarker.slice(0, afterMarker.indexOf(retryMarker))
    : afterMarker
  try {
    return JSON.parse(jsonText) as ParsedBatchPayload
  } catch {
    return {}
  }
}

export function buildDefaultBatchResponse(call: FakeModelCall): BatchGradeOutput {
  const parsed = parseBatchPayloadFromPrompt(call.prompt)
  const indices = Array.isArray(parsed.prompt_indices) ? parsed.prompt_indices : [0]

  const prompts = indices.map((promptIndex) => ({
    prompt_index: promptIndex,
    scores: {
      goal: 2,
      context: 2,
      constraints: 1,
      verification: 2,
      steps: 2,
    },
    reasons: {
      goal: "States a clear, concrete feature outcome.",
      context: "Names the target file to update.",
      constraints: "Implies keeping the change focused, though limits could be firmer.",
      verification: "Asks to run tests to confirm the change.",
      steps: "Scoped cleanly to one step.",
    },
    total: 9,
    improved_prompt: `Update the target file for step ${promptIndex + 1}, keep existing exports unchanged, and show the passing test output.`,
    confidence: 0.91,
  }))

  if (!parsed.include_session_summary) {
    return { prompts }
  }

  const projectName = parsed.session_overview?.project_name || "the project"
  const hasTeachQA = (parsed.session_overview?.teach_qa?.length ?? 0) > 0

  return {
    prompts,
    understanding: {
      score: hasTeachQA ? 8 : 7,
      reason: hasTeachQA
        ? "Answered teach check questions accurately and verified changes with tests."
        : "Followed each step cleanly and checked results with tests.",
    },
    notes: {
      what_was_built: `Added validation updates and test coverage across ${projectName}.`,
      things_learned: [
        "Scope each prompt to a single clear change.",
        "Validate input on the server as well as the client.",
        "Run unit tests right after each edit.",
      ],
      things_to_work_on: [
        "State explicit constraints on what should not change.",
        "Include expected failure cases in verification steps.",
      ],
      summary: `You updated validation and tests in ${projectName}. You practiced scoping changes to one step, checking server input, and running tests after edits. Next session, add clearer do-not-touch constraints and include edge-case checks.`,
    },
  }
}

function extractPromptParts(promptMessages: ReadonlyArray<{ readonly role: string; readonly content: unknown }>): {
  system: string
  prompt: string
} {
  let system = ""
  const userParts: string[] = []

  for (const message of promptMessages) {
    if (message.role === "system" && typeof message.content === "string") {
      system = system ? `${system}\n${message.content}` : message.content
      continue
    }
    if (message.role === "user") {
      if (typeof message.content === "string") {
        userParts.push(message.content)
      } else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          if (typeof part === "object" && part !== null && (part as { type?: unknown }).type === "text") {
            const text = (part as { text?: unknown }).text
            if (typeof text === "string") userParts.push(text)
          }
        }
      }
    }
  }

  return { system, prompt: userParts.join("\n") }
}

export class FakeModel {
  readonly calls: FakeModelCall[] = []
  private readonly handler: FakeModelHandler
  private responseCursor = 0

  constructor(options: FakeModelOptions = {}) {
    if (options.onGenerate) {
      this.handler = options.onGenerate
    } else if (options.responses) {
      const queue = [...options.responses]
      this.handler = (call) => {
        if (this.responseCursor >= queue.length) {
          return buildDefaultBatchResponse(call)
        }
        const next = queue[this.responseCursor]
        this.responseCursor += 1
        if (next instanceof Error) throw next
        return next
      }
    } else {
      this.handler = (call) => buildDefaultBatchResponse(call)
    }
  }

  asLanguageModel(spec: GraderModelSpec): LanguageModel {
    return new MockLanguageModelV4({
      provider: spec.provider,
      modelId: spec.model,
      doGenerate: async (options) => {
        const { system, prompt } = extractPromptParts(options.prompt)
        const call: FakeModelCall = {
          spec,
          system,
          prompt,
          abortSignal: options.abortSignal,
          attempt: this.calls.length + 1,
        }
        this.calls.push(call)

        const raw = await this.handler(call)
        const text = typeof raw === "string" ? raw : JSON.stringify(raw)

        return {
          content: [{ type: "text", text }],
          finishReason: { unified: "stop", raw: undefined },
          usage: {
            inputTokens: { total: 100, noCache: 100, cacheRead: 0, cacheWrite: 0 },
            outputTokens: { total: 100, text: 100, reasoning: 0 },
          },
          warnings: [],
        }
      },
    })
  }
}
