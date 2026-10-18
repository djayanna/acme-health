/**
 * AI voice agent (inbound) — answer questions from a knowledge base, book
 * appointments, and hand off to a person.
 *
 * Flow (all transport handled by Twilio Agent Connect, `src/tac/`):
 *   Twilio number's Voice webhook → POST /twiml (TACServer, signature-checked)
 *     → ConversationRelay TwiML: greeting + `<Connect action>` for the handoff
 *     → caller speaks; TAC queues each turn and calls `tac.onMessageReady`
 *     → the agent resolves the turn with the LangChain agent (`src/llm/`) and its tools (`src/tools/`)
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

import { modelSpec, runTurn, userMessage, type Message, type Tool } from '../llm/index.js'
import { emitEvent } from '../observability.js'
import { SYSTEM_PROMPT } from '../prompts/voiceAgent.js'
import { CallContext, orchestrated, studioHandoffEnabled, tac, voiceChannel } from '../tac/index.js'
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
  /** Set once `callEnded` is recorded. */
  ended?: boolean
}

const CALLS = new Map<string, Call>()

// Inbound TwiML: the agent's own greeting, plus the `<Connect action>` the warm transfer
// catches. With a Studio flow configured, RELAY_ACTION_URL is undefined and TAC points
// the action at the flow instead.
//
// In orchestrated mode TAC also adds `conversationConfiguration`, so ConversationRelay
// creates the Orchestrator conversation (and its transcript) when the call starts —
// TAC then finds it by Call SID. Keep that, and keep VOICE capture rules OFF for this
// number on the configuration: both together run two speech-to-text engines per call.
// https://www.twilio.com/docs/conversations/orchestrator/concepts/channels
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
    emitEvent('voiceAgent', 'callStarted', 'start', {
      correlationId: session.callSid ?? conversationId,
      payload: {
        mode: orchestrated ? 'orchestrated' : 'relay-only',
        conversationId: orchestrated ? conversationId : null,
        memory: memory ? 'loaded' : 'none',
        model: modelSpec().model,
      },
    })
  }
  const { ctx } = call
  if (ctx.handedOff) return

  call.history.push(userMessage(message))
  const startedAt = Date.now()
  const reply = runTurn(call.history, call.system, TOOLS, ctx, {
    signal: abortSignal,
    wrapUp: () => ctx.handedOff,
    onToolCall: (tool) => emitEvent('agent', 'toolCall', tool.ok ? 'success' : 'error', {
      correlationId: session.callSid ?? conversationId,
      status: tool.ok ? 'success' : 'error',
      payload: tool,
    }),
  })
  const spoken = await voiceChannel.sendStreamingResponse(conversationId, reply, abortSignal ? { signal: abortSignal } : {})
  emitEvent('agent', 'turn', abortSignal?.aborted ? 'interrupted' : 'success', {
    correlationId: session.callSid ?? conversationId,
    payload: { durationMs: Date.now() - startedAt, replyChars: spoken.length, interrupted: Boolean(abortSignal?.aborted) },
  })

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
  const data = JSON.parse(pending.handoffData) as Record<string, unknown>
  emitEvent('voiceAgent', 'handoff', 'success', {
    correlationId: ctx.session.callSid ?? conversationId,
    payload: { target: studioHandoffEnabled ? 'studio' : 'warm-transfer', reasonCode: data.reasonCode ?? null, reason: data.reason ?? null },
  })
}

/** The call's stats for `callEnded`, taken once — before its state is dropped. */
function endCall(conversationId: string, callSid: string | undefined, startedAt: Date): void {
  const call = CALLS.get(conversationId)
  if (!call || call.ended) return
  call.ended = true
  emitEvent('voiceAgent', 'callEnded', 'success', {
    correlationId: callSid ?? conversationId,
    payload: {
      durationSec: Math.round((Date.now() - startedAt.getTime()) / 1000),
      turns: call.history.filter((m) => m.getType() === 'human').length,
      verified: Boolean(call.ctx.verifiedPatientId),
      handedOff: call.ctx.handedOff,
    },
  })
}

// The WebSocket closes first in both modes; orchestrated mode keeps TAC's session until
// Conversation Orchestrator closes it, which can be well after hang-up. Record the end
// here and drop per-call agent state.
voiceChannel.on('webSocketDisconnected', ({ conversationId }: { conversationId: string }) => {
  const call = CALLS.get(conversationId)
  if (call) endCall(conversationId, call.ctx.session.callSid, call.ctx.session.startedAt)
  CALLS.delete(conversationId)
})

tac.onConversationEnded(({ session }) => {
  endCall(session.conversationId, session.callSid, session.startedAt)
  CALLS.delete(session.conversationId)
})

/** TAC owns the voice routes (/twiml, the WebSocket, the relay callback). */
export async function routes(_app: FastifyInstance): Promise<void> {}
