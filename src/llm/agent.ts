/**
 * Runtime agent — a LangChain `createAgent` loop over whichever model `LLM_MODEL` picks
 * (see `models.ts`).
 *
 * Transport-agnostic: `runTurn` takes the call's message history, the system prompt,
 * the tools and a per-call `ctx`, and yields the assistant's text as it streams (for
 * voice, TAC turns each chunk into a ConversationRelay `text` token).
 *
 * Tools keep the provider-neutral `Tool` shape (name + description + JSON-Schema
 * parameters + `run(args, ctx)`); they are wrapped as LangChain tools here and receive
 * `ctx` through the agent's runtime context. A failing tool returns an error result so
 * the model can react to it; it never throws out of the turn.
 *
 * History is append-only: each turn's new messages are appended exactly as the model
 * returned them (Claude's signed thinking blocks included). If the caller barges in,
 * only the text already spoken is recorded.
 */

import { randomUUID } from 'node:crypto'

import { AIMessage, AIMessageChunk, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { tool as langchainTool, type StructuredToolInterface } from '@langchain/core/tools'
import { createAgent, createMiddleware } from 'langchain'

import { createChatModel } from './models.js'

export const STUCK_REPLY = 'Sorry, I got a little stuck there. Could you say that again?'
export const ERROR_REPLY = "Sorry, I'm having trouble on my end. Could you say that again in a moment?"

/** Model calls + tool calls in one turn; each tool round trip is ~2 graph steps. */
const RECURSION_LIMIT = 12

/**
 * A tool the agent may call mid-conversation. `ctx` is whatever per-call context the
 * handler threads through; it is passed straight to `run` and never inspected here.
 * `parameters` must list every property in `required` — tools are sent with
 * `strict: true` where the provider supports it.
 */
export interface Tool<Ctx = unknown> {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] }
  run: (args: any, ctx: Ctx) => Promise<unknown> | unknown
}

export type Message = BaseMessage

export interface TurnOptions {
  /** Aborts the in-flight turn when the caller barges in. */
  signal?: AbortSignal
  /**
   * Checked before each model call — true once a tool has queued a handoff. The model
   * then gets one last reply with tools disabled (its "connecting you now").
   */
  wrapUp?: () => boolean
  /** Called after each tool run with a summary safe to log (no arguments or results). */
  onToolCall?: (summary: ToolCallSummary) => void
}

/**
 * What a tool call did, without its arguments or full result — those can hold PHI
 * (names, dates of birth). `outcome` is the result's own top-level flags only.
 */
export interface ToolCallSummary {
  tool: string
  ok: boolean
  durationMs: number
  outcome: Record<string, boolean | number | string | null>
  error?: string
}

/** Per-turn values the agent's tools and middleware read from `runtime.context`. */
interface TurnContext {
  ctx: unknown
  wrapUp?: () => boolean
  onToolCall?: (summary: ToolCallSummary) => void
}

/** Top-level booleans, numbers and short status strings from a tool result — nothing nested. */
function outcomeOf(result: unknown): ToolCallSummary['outcome'] {
  if (!result || typeof result !== 'object') return {}
  const out: ToolCallSummary['outcome'] = {}
  for (const [key, value] of Object.entries(result)) {
    if (typeof value === 'boolean' || typeof value === 'number' || value === null) out[key] = value
    else if (Array.isArray(value)) out[`${key}Count`] = value.length
    else if (key === 'error' && typeof value === 'string') out.error = value.slice(0, 120)
  }
  return out
}

/** Wrap a provider-neutral `Tool` as a LangChain tool that gets `ctx` from the runtime. */
function toLangChainTool(t: Tool): StructuredToolInterface {
  return langchainTool(
    async (args: unknown, config) => {
      const { ctx, onToolCall } = (config as { context?: TurnContext }).context ?? ({} as TurnContext)
      const started = Date.now()
      try {
        const result = (await t.run(args, ctx)) ?? {}
        const outcome = outcomeOf(result)
        onToolCall?.({ tool: t.name, ok: !('error' in outcome), durationMs: Date.now() - started, outcome })
        return JSON.stringify(result)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        onToolCall?.({ tool: t.name, ok: false, durationMs: Date.now() - started, outcome: {}, error: error.slice(0, 120) })
        return JSON.stringify({ error })
      }
    },
    {
      name: t.name,
      description: t.description,
      schema: { ...t.parameters, additionalProperties: false },
      extras: { strict: true },
    },
  ) as StructuredToolInterface
}

/**
 * Wraps every model call:
 *  - once a handoff is queued, the call can only speak, not call tools;
 *  - the reply gets a fresh id if one already in the history has the same id. The agent
 *    merges messages by id, so a provider or proxy that reuses ids would otherwise have
 *    its tool-call message treated as already handled and the turn would stop short.
 */
const agentMiddleware = createMiddleware({
  name: 'VoiceAgentModelCall',
  wrapModelCall: async (request, handler) => {
    const { wrapUp } = (request.runtime.context ?? {}) as TurnContext
    const reply = await handler(wrapUp?.() ? { ...request, toolChoice: 'none' } : request)
    if (reply.id && request.messages.some((m) => m.id === reply.id)) reply.id = randomUUID()
    return reply
  },
})

type Agent = ReturnType<typeof createAgent>
const agents = new Map<string, Promise<Agent>>()

/** One compiled agent per system prompt + tool set (system prompts differ per call when memory is on). */
function agentFor(system: string, tools: Tool[]): Promise<Agent> {
  const key = `${system}\u0000${tools.map((t) => t.name).join(',')}`
  let agent = agents.get(key)
  if (!agent) {
    agent = createChatModel().then((model) =>
      createAgent({
        model,
        tools: tools.map(toLangChainTool),
        systemPrompt: system,
        middleware: [agentMiddleware],
      }),
    )
    agents.set(key, agent)
    // Memory-bearing prompts are per caller: don't let the cache grow without bound.
    if (agents.size > 200) agents.delete(agents.keys().next().value!)
  }
  return agent
}

/** The text of a streamed chunk, across providers (string or content-block arrays). */
function chunkText(chunk: AIMessageChunk): string {
  if (typeof chunk.content === 'string') return chunk.content
  return chunk.content
    .map((part) => (part.type === 'text' && 'text' in part ? String(part.text) : ''))
    .join('')
}

/**
 * Run one caller turn: yield the assistant's text as it streams, let the agent loop
 * through any tool calls, and append the turn's new messages to `history`.
 */
export async function* runTurn<Ctx = unknown>(
  history: Message[],
  system: string,
  tools: Tool<Ctx>[],
  ctx: Ctx,
  { signal, wrapUp, onToolCall }: TurnOptions = {},
): AsyncGenerator<string> {
  const agent = await agentFor(system, tools as Tool[])
  let spoken = ''
  // This turn's new messages, in the order each agent step produced them. Collected
  // from per-step updates rather than the final state: the state merges messages by
  // id, and a provider that reuses ids across a turn would lose the tool-call message.
  const added: BaseMessage[] = []

  try {
    const stream = await agent.stream(
      { messages: [...history] },
      {
        streamMode: ['messages', 'updates'],
        context: { ctx, wrapUp, onToolCall } satisfies TurnContext,
        recursionLimit: RECURSION_LIMIT,
        signal,
      } as never,
    )
    for await (const [mode, payload] of stream as AsyncIterable<[string, any]>) {
      if (mode === 'updates') {
        for (const update of Object.values(payload ?? {}) as Array<{ messages?: BaseMessage[] }>) {
          if (Array.isArray(update?.messages)) added.push(...update.messages)
        }
      } else if (mode === 'messages') {
        const [chunk] = payload as [BaseMessage]
        if (!AIMessageChunk.isInstance(chunk)) continue
        const text = chunkText(chunk)
        if (text) {
          spoken += text
          yield text
        }
      }
    }
  } catch (err) {
    if (signal?.aborted) {
      // The caller barged in: record only what they heard.
      if (spoken) history.push(new AIMessage(`${spoken} — [interrupted by caller]`))
      return
    }
    console.error('llm: agent turn failed', err)
    const recursion = err instanceof Error && err.name === 'GraphRecursionError'
    const reply = recursion ? STUCK_REPLY : ERROR_REPLY
    if (!spoken) yield reply
    history.push(new AIMessage(spoken || reply))
    return
  }

  if (signal?.aborted) {
    if (spoken) history.push(new AIMessage(`${spoken} — [interrupted by caller]`))
    return
  }
  // Append only what this turn added, exactly as the agent produced it.
  history.push(...added)
}

/** The caller's words as a history message. */
export function userMessage(text: string): Message {
  return new HumanMessage(text)
}
