/**
 * AI voice agent (inbound) — answer questions from a knowledge base, book
 * appointments, and hand off to a person.
 *
 * Flow (all transport handled by Twilio Agent Connect, `src/tac/`):
 *   Twilio number's Voice webhook → POST /twiml (TACServer, signature-checked)
 *     → ConversationRelay TwiML: greeting + `<Connect action>` for the handoff
 *     → caller speaks; TAC queues each turn and calls `tac.onMessageReady`
 *     → the agent resolves the turn with Claude (`src/llm/`) and its tools (`src/tools/`)
 *     → the reply streams back token by token; a barge-in aborts it
 *
 * Exports `routes` (none of its own — TAC owns the voice routes) and wires TAC's
 * callbacks on import.
 *
 * In orchestrated mode, Conversation Memory (profile, observations, past summaries) is
 * fetched once per call and appended to SYSTEM_PROMPT with MemoryPromptBuilder. In
 * ConversationRelay-only mode there is no memory and the prompt is used as-is.
 */

import type { FastifyInstance } from 'fastify'
import { MemoryPromptBuilder, type ConversationId } from 'twilio-agent-connect'

import { runTurn, type Message, type Tool } from '../llm/index.js'
import { emitEvent } from '../observability.js'
import { SYSTEM_PROMPT } from '../prompts/voiceAgent.js'
import { CallContext, tac, voiceChannel } from '../tac/index.js'
import { SHARED_TOOLS } from '../tools/index.js'
import { TOOLS as KNOWLEDGE_TOOLS } from '../tools/knowledge.js'
import { TOOLS as SCHEDULING_TOOLS } from '../tools/scheduling.js'
import { TOOLS as VERIFICATION_TOOLS } from '../tools/verification.js'
import { RELAY_ACTION_URL } from '../tools/warmTransfer.js'

const GREETING =
  'Thanks for calling Acme Health. I can answer questions about the clinic, or book or change an appointment. How can I help?'

/** The tools the agent may call each turn: its own, plus `SHARED_TOOLS` (the add-ons'). */
const TOOLS: Tool<CallContext>[] = [
  ...(KNOWLEDGE_TOOLS as Tool<CallContext>[]),
  ...VERIFICATION_TOOLS,
  ...SCHEDULING_TOOLS,
  ...SHARED_TOOLS,
]

/** Per-call state. The system prompt is fixed at the first turn so it never changes mid-call. */
interface Call {
  ctx: CallContext
  system: string
  history: Message[]
}

const CALLS = new Map<string, Call>()

// Inbound TwiML: the agent's own greeting, plus the `<Connect action>` the warm transfer
// catches. With a Studio flow configured, RELAY_ACTION_URL is undefined and TAC points
// the action at the flow instead.
voiceChannel.onInboundCallTwiml(async () => ({
  welcomeGreeting: GREETING,
  ...(RELAY_ACTION_URL && { actionUrl: RELAY_ACTION_URL }),
  ...(process.env.RELAY_VOICE && { voice: process.env.RELAY_VOICE }),
  ...(process.env.RELAY_LANGUAGE && { language: process.env.RELAY_LANGUAGE }),
}))

tac.onMessageReady(async ({ conversationId, message, memory, session, channel, abortSignal }) => {
  if (channel !== 'voice') return

  let call = CALLS.get(conversationId)
  if (!call) {
    call = {
      ctx: new CallContext(session),
      system: MemoryPromptBuilder.compose(SYSTEM_PROMPT, memory, session),
      history: [],
    }
    CALLS.set(conversationId, call)
    emitEvent('voiceAgent', 'callStarted', 'start', { correlationId: session.callSid ?? conversationId })
  }
  const { ctx } = call
  if (ctx.handedOff) return

  call.history.push({ role: 'user', content: message })
  const reply = runTurn(call.history, call.system, TOOLS, ctx, {
    signal: abortSignal,
    wrapUp: () => ctx.handedOff,
  })
  await voiceChannel.sendStreamingResponse(conversationId, reply, abortSignal ? { signal: abortSignal } : {})

  sendPendingHandoff(conversationId, ctx)
  // Returning nothing: the reply has already been streamed.
})

/**
 * After the goodbye has streamed, send the queued ConversationRelay `end` frame.
 * Twilio then POSTs the `<Connect action>` URL with `HandoffData`, which takes over.
 * (TAC sends this frame on its own only from the non-streaming `sendResponse`.)
 */
function sendPendingHandoff(conversationId: ConversationId, ctx: CallContext): void {
  const pending = ctx.session.pendingHandoffData
  if (!pending) return
  const ws = voiceChannel.getWebsocket(conversationId)
  if (!ws) return
  ws.send(JSON.stringify(pending))
  delete ctx.session.pendingHandoffData
  ctx.markHandoffSent()
  emitEvent('voiceAgent', 'handoff', 'success', { correlationId: ctx.session.callSid ?? conversationId })
}

tac.onConversationEnded(({ session }) => {
  CALLS.delete(session.conversationId)
  emitEvent('voiceAgent', 'callEnded', 'success', { correlationId: session.callSid ?? session.conversationId })
})

// Orchestrated mode keeps a session until Conversation Orchestrator closes it, which can
// be well after hang-up; per-call agent state isn't needed past the WebSocket.
voiceChannel.on('webSocketDisconnected', ({ conversationId }: { conversationId: string }) => {
  CALLS.delete(conversationId)
})

/** TAC owns the voice routes (/twiml, the WebSocket, the relay callback). */
export async function routes(_app: FastifyInstance): Promise<void> {}
