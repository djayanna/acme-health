/**
 * Runtime agent — OpenAI adapter.
 *
 * The generated app's conversational brain. It is transport-agnostic: `runTurn`
 * takes the running message history, the tools the agent may call, and a
 * `TokenSink` the caller uses to stream assistant text back to wherever it needs
 * to go (for a voice app, each token becomes a ConversationRelay `text` frame).
 *
 * This module is independent of the LLM that *generated* this project. The runtime
 * always talks to OpenAI, configured from this app's own environment:
 *   OPENAI_API_KEY   — required
 *   OPENAI_MODEL     — optional, defaults to gpt-4o-mini
 *
 * Tools use the provider-neutral `Tool` shape (name + description + JSON-Schema
 * parameters + a `run(args, ctx)` function). `runTurn` translates them to OpenAI's
 * tool format and dispatches calls through `executeTool`, which never throws — a
 * failing tool returns `{ error }` so the model can react to it.
 */

import OpenAI from 'openai'
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from 'openai/resources/chat/completions'

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
// `||` (not `??`): .env.example ships `OPENAI_MODEL=` (empty), and an empty string is
// a real-but-invalid model — fall back to the default for it too, not just undefined.
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

/** Streams assistant text to the transport. `last` marks the final chunk of a turn. */
export type TokenSink = (token: string, last: boolean) => void

/**
 * A tool the agent may call mid-conversation. `ctx` is whatever per-call context
 * the handler threads through (call SID, the relay `send`, a boxed `ended` flag…);
 * it is passed straight to `run` and never inspected here.
 */
export interface Tool<Ctx = unknown> {
  name: string
  description: string
  parameters: Record<string, unknown>
  run: (args: any, ctx: Ctx) => Promise<unknown> | unknown
}

export type Message = ChatCompletionMessageParam

const MAX_HOPS = 5

/** Translate the provider-neutral tools to OpenAI's tool schema. */
function toOpenAiTools(tools: Tool[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }))
}

/** Run one tool, returning its result or an `{ error }` object — never throws. */
async function executeTool(tools: Tool[], name: string, args: unknown, ctx: unknown): Promise<unknown> {
  const tool = tools.find((t) => t.name === name)
  if (!tool) return { error: `Unknown tool: ${name}` }
  try {
    return await tool.run(args, ctx)
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) }
  }
}

interface StreamedToolCall {
  id: string
  name: string
  args: string
}

/**
 * Run one caller turn: stream the assistant's tokens through `onToken`, loop
 * through any tool calls the model requests (bounded by MAX_HOPS), and append
 * every message to `history` in place so the next turn has full context.
 *
 * `isDone`, when supplied, is checked before each model call: a tool that ends the
 * session (e.g. a handoff) makes it return `true`, so the loop stops instead of
 * streaming more text onto a closed session.
 */
export async function runTurn<Ctx = unknown>(
  history: Message[],
  tools: Tool<Ctx>[],
  onToken: TokenSink,
  ctx: Ctx,
  isDone?: () => boolean,
): Promise<void> {
  const openAiTools = toOpenAiTools(tools as Tool[])

  for (let hop = 0; hop < MAX_HOPS; hop++) {
    // A tool that ends the session (e.g. a handoff) flips this; stop rather than
    // stream more text onto a closed session.
    if (isDone?.()) return
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: history,
      tools: openAiTools.length ? openAiTools : undefined,
      stream: true,
    })

    let assistantText = ''
    const toolCalls: Record<number, StreamedToolCall> = {}

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta
      if (!delta) continue

      if (delta.content) {
        assistantText += delta.content
        onToken(delta.content, false)
      }

      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const acc = (toolCalls[tc.index] ??= { id: '', name: '', args: '' })
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name = tc.function.name
          if (tc.function?.arguments) acc.args += tc.function.arguments
        }
      }
    }

    const calls = Object.values(toolCalls)

    // No tool calls — the model answered. Close the turn and stop.
    if (calls.length === 0) {
      history.push({ role: 'assistant', content: assistantText })
      onToken('', true)
      return
    }

    history.push({
      role: 'assistant',
      content: assistantText.length ? assistantText : null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.args || '{}' },
      })),
    })

    for (const call of calls) {
      let args: unknown = {}
      try {
        args = JSON.parse(call.args || '{}')
      } catch {
        args = {}
      }
      const result = await executeTool(tools as Tool[], call.name, args, ctx)
      history.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result ?? {}),
      })
    }
    // Loop so the model can respond to the tool results.
  }

  // Ran out of hops without a final answer — say something rather than hang.
  onToken('Sorry, I got a little stuck there. Could you say that again?', true)
}
