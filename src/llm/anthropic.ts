/**
 * Runtime agent — Anthropic (Claude) adapter.
 *
 * The app's conversational brain. It is transport-agnostic: `runTurn` takes the call's
 * message history, the tools the agent may call and a per-call `ctx`, and yields the
 * assistant's text as it streams (for voice, TAC turns each chunk into a
 * ConversationRelay `text` token).
 *
 * Configured from this app's own environment:
 *   ANTHROPIC_API_KEY  — required (or any credential the Anthropic SDK resolves)
 *   ANTHROPIC_MODEL    — optional, defaults to claude-opus-5-5
 *   ANTHROPIC_EFFORT   — optional, defaults to low (voice is latency-sensitive)
 *
 * History is append-only: every assistant message goes back exactly as the API sent
 * it (thinking blocks included), and the system prompt and tool list never change
 * mid-call. Claude Opus 5.5 rejects replayed thinking after any edit to earlier turns.
 *
 * Tools use the provider-neutral `Tool` shape (name + description + JSON-Schema
 * parameters + `run(args, ctx)`). A failing tool returns an error result so the model
 * can react to it; it never throws out of the turn.
 */

import Anthropic from '@anthropic-ai/sdk'
import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageParam,
  BetaTool,
  BetaToolResultBlockParam,
} from '@anthropic-ai/sdk/resources/beta/messages/messages'

const client = new Anthropic()
// `||` (not `??`): .env.example ships these empty, and an empty string is not a model.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5-5'
const EFFORT = (process.env.ANTHROPIC_EFFORT || 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max'
const MAX_TOKENS = 16000
const MAX_HOPS = 5

/** On a safety-classifier decline, the API re-runs the turn on Anthropic's recommended fallback model. */
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'

export const STUCK_REPLY = 'Sorry, I got a little stuck there. Could you say that again?'
export const ERROR_REPLY = "Sorry, I'm having trouble on my end. Could you say that again in a moment?"
export const REFUSAL_REPLY = "I'm sorry, I can't help with that. I can connect you with someone at the office."

/**
 * A tool the agent may call mid-conversation. `ctx` is whatever per-call context the
 * handler threads through; it is passed straight to `run` and never inspected here.
 * `parameters` must list every property in `required` — tools are sent with
 * `strict: true`, so the model's input always matches the schema.
 */
export interface Tool<Ctx = unknown> {
  name: string
  description: string
  parameters: { type: 'object'; properties: Record<string, unknown>; required: string[] }
  run: (args: any, ctx: Ctx) => Promise<unknown> | unknown
}

export type Message = BetaMessageParam

export interface TurnOptions {
  /** Aborts the in-flight request when the caller barges in. */
  signal?: AbortSignal
  /**
   * Checked before each model call — true once a tool has queued a handoff. The model
   * then gets one last reply with tools disabled (its "connecting you now") and the
   * turn ends.
   */
  wrapUp?: () => boolean
}

function toAnthropicTools(tools: Tool[]): BetaTool[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: { ...tool.parameters, additionalProperties: false },
    strict: true,
  }))
}

/** Run one tool, returning a `tool_result` block — never throws. */
async function executeTool(tools: Tool[], name: string, id: string, input: unknown, ctx: unknown) {
  const tool = tools.find((t) => t.name === name)
  const result: BetaToolResultBlockParam = { type: 'tool_result', tool_use_id: id }
  if (!tool) return { ...result, is_error: true, content: `Unknown tool: ${name}` }
  try {
    return { ...result, content: JSON.stringify((await tool.run(input, ctx)) ?? {}) }
  } catch (err) {
    return { ...result, is_error: true, content: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * The assistant content to append to history. After a mid-output fallback, blocks
 * before the last `fallback` marker that the fallback model can't continue from
 * (thinking, tool calls) are dropped; everything else is kept as sent.
 */
function echoableContent(content: BetaContentBlock[]): BetaContentBlockParam[] {
  const boundary = content.map((b) => b.type).lastIndexOf('fallback')
  return content.filter(
    (b, i) => i > boundary || !['thinking', 'redacted_thinking', 'tool_use'].includes(b.type),
  ) as BetaContentBlockParam[]
}

/**
 * Run one caller turn: yield the assistant's text as it streams, loop through any tool
 * calls the model requests (bounded by MAX_HOPS), and append every message to
 * `history` in place so the next turn has full context.
 *
 * If `signal` aborts (the caller interrupted), the turn stops and records only the
 * part of the reply that was already streamed, so the model knows where it was cut off.
 */
export async function* runTurn<Ctx = unknown>(
  history: Message[],
  system: string,
  tools: Tool<Ctx>[],
  ctx: Ctx,
  { signal, wrapUp }: TurnOptions = {},
): AsyncGenerator<string> {
  const anthropicTools = toAnthropicTools(tools as Tool[])

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (signal?.aborted) return
    // Changing tool_choice keeps the tool list (and earlier thinking blocks) intact.
    const finalHop = wrapUp?.() ?? false

    let streamed = ''
    let message: BetaMessage
    try {
      const stream = client.beta.messages.stream(
        {
          model: MODEL,
          max_tokens: MAX_TOKENS,
          betas: [FALLBACK_BETA],
          fallbacks: 'default',
          output_config: { effort: EFFORT },
          cache_control: { type: 'ephemeral' },
          system,
          tools: anthropicTools,
          ...(finalHop && { tool_choice: { type: 'none' as const } }),
          messages: history,
        },
        { signal },
      )
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          streamed += event.delta.text
          yield event.delta.text
        }
      }
      message = await stream.finalMessage()
    } catch (err) {
      if (signal?.aborted || err instanceof Anthropic.APIUserAbortError) return // `finally` records it
      console.error('llm: Claude request failed', err instanceof Anthropic.APIError ? err.status : '', err)
      if (!streamed) yield ERROR_REPLY
      history.push({ role: 'assistant', content: streamed || ERROR_REPLY })
      return
    } finally {
      // The caller barged in — whether the request was aborted or TAC stopped reading
      // mid-stream. Record only what was spoken, so the model knows it was cut off.
      if (signal?.aborted && streamed && history.at(-1)?.role !== 'assistant') {
        history.push({ role: 'assistant', content: `${streamed} — [interrupted by caller]` })
      }
    }

    if (message.stop_reason === 'refusal') {
      // The whole fallback chain declined. Don't replay the refused content.
      yield streamed ? ` ${REFUSAL_REPLY}` : REFUSAL_REPLY
      history.push({ role: 'assistant', content: REFUSAL_REPLY })
      return
    }

    const toolCalls = message.content.filter((b) => b.type === 'tool_use')

    // No tool calls — the model answered. Close the turn.
    if (toolCalls.length === 0) {
      history.push({ role: 'assistant', content: echoableContent(message.content) })
      return
    }

    // A tool call we must not run: its input may be truncated (max_tokens), or the call
    // is already being handed off. Answer each call so the history stays valid.
    if (finalHop || message.stop_reason === 'max_tokens') {
      const why = finalHop ? 'the call is being transferred' : 'the response hit max_tokens'
      history.push({ role: 'assistant', content: echoableContent(message.content) })
      history.push({
        role: 'user',
        content: toolCalls.map((c) => ({
          type: 'tool_result' as const,
          tool_use_id: c.id,
          is_error: true,
          content: `Not run: ${why}.`,
        })),
      })
      if (!finalHop) {
        yield STUCK_REPLY
        history.push({ role: 'assistant', content: STUCK_REPLY })
      }
      return
    }

    history.push({ role: 'assistant', content: echoableContent(message.content) })
    // Every tool_use needs its tool_result in the very next (single) user message.
    const results = await Promise.all(
      toolCalls.map((c) => executeTool(tools as Tool[], c.name, c.id, c.input, ctx)),
    )
    history.push({ role: 'user', content: results })
    // Loop so the model can respond to the tool results.
  }

  if (!signal?.aborted) {
    yield STUCK_REPLY
    history.push({ role: 'assistant', content: STUCK_REPLY })
  }
}
