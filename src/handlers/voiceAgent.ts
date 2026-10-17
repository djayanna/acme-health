/**
 * AI voice agent (inbound) — answer questions from a knowledge base, book
 * appointments, and hand off through any tool an add-on supplies.
 *
 * Flow:
 *   Twilio number's Voice webhook → POST /voice/answer
 *     → ConversationRelay TwiML (greeting + optional relay `action` URL)
 *     → caller speaks; each turn reaches VoiceAgent.onPrompt over /relay/ws
 *     → the agent resolves the turn with its tools (`src/tools/`)
 *
 * Routes (exported as `router`, listed in `src/handlers/` and mounted by app.ts):
 *   POST /voice/answer   → inbound entry: hand the call to ConversationRelay
 *
 * Each caller turn runs `runTurn` (the OpenAI tool-use loop in `src/llm/`), driven by
 * SYSTEM_PROMPT (`src/prompts/voiceAgent.ts`) and TOOLS — the agent's own tools plus
 * `SHARED_TOOLS`. Every tool gets a `RelayToolCtx` for the call, so a tool can speak
 * or end the relay session.
 */

import { Router } from 'express'

import { runTurn, type Message, type Tool } from '../llm/index.js'
import { SYSTEM_PROMPT } from '../prompts/voiceAgent.js'
import {
  RelayHandler,
  RelayReply,
  RelayToolCtx,
  buildRelayTwiml,
  registerRelayHandler,
  type RelayEvent,
  type Send,
} from '../relay/index.js'
import { SHARED_TOOLS } from '../tools/index.js'
import { TOOLS as KNOWLEDGE_TOOLS } from '../tools/knowledge.js'
import { TOOLS as SCHEDULING_TOOLS } from '../tools/scheduling.js'

export const router = Router()


const GREETING =
  'Thanks for calling. I can answer questions about the clinic, or book or change an appointment. How can I help?'

router.post('/voice/answer', (_req, res) => {
  // Inbound entry — point the number's Voice webhook here. Owns the TwiML so the
  // greeting is the agent's own. RELAY_ACTION_URL, when set, becomes the relay
  // `action` URL: Twilio requests it when the agent ends the session, so a route
  // there can take the call over (e.g. a transfer to a person).
  const twiml = buildRelayTwiml({
    welcomeGreeting: GREETING,
    action: process.env.RELAY_ACTION_URL || undefined,
  })
  res.type('text/xml').send(twiml)
})


/** The tools the agent may call each turn, in the `Tool` shape the runtime agent runs:
 * its own, plus `SHARED_TOOLS` — whatever the app's add-ons give the agent (e.g. a
 * hand-off to a person), collected by the generated `src/tools/` index. */
const TOOLS: Tool<RelayToolCtx>[] = [...KNOWLEDGE_TOOLS, ...SCHEDULING_TOOLS, ...SHARED_TOOLS]

/** The conversational agent: each caller turn runs the OpenAI tool-use loop in
 * `runTurn`. History persists for the whole call; once a tool ends the session
 * (`ctx.ended`), no further turns are taken. */
export class VoiceAgent extends RelayHandler {
  private history: Message[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  private ctx?: RelayToolCtx

  async onPrompt(transcript: string, _event: RelayEvent, send: Send): Promise<void> {
    const ctx = (this.ctx ??= new RelayToolCtx(send, this.session))
    if (ctx.ended) return
    this.history.push({ role: 'user', content: transcript })
    await runTurn(
      this.history,
      TOOLS,
      (token, last) => send(RelayReply.text(token, { last })),
      ctx,
      () => ctx.ended,
    )
  }
}

registerRelayHandler(VoiceAgent)

