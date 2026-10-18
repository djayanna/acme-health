/**
 * Hand the caller to a person at the office.
 *
 * Two paths, picked by the environment:
 *   - Studio handoff (orchestrated mode + TWILIO_STUDIO_HANDOFF_FLOW_SID): TAC's
 *     `createStudioHandoffTool` packages the conversation and memory for a Studio
 *     flow (e.g. Flex). TAC points the relay `action` URL at the flow.
 *   - Warm transfer over the PSTN (everything else, incl. ConversationRelay-only mode):
 *     park the caller in a per-call conference on hold, dial the office, confirm with
 *     a keypress, then bridge. Busy / no-answer / failed / declined / voicemail all
 *     fall back to the caller with an apology.
 * Either way the tool only queues the handoff; the voice handler sends the relay `end`
 * frame after the agent's goodbye has been spoken.
 *
 * Routes (exported as `routes`, registered by app.ts; every one checks the Twilio signature):
 *   POST /transfer/action         → ConversationRelay `action` URL: park + dial office
 *   POST /transfer/office-answer  → office answered: say reason, gather accept
 *   POST /transfer/office-gather  → office keypress: bridge (1) or recover
 *   POST /transfer/office-status  → office leg status: busy / no-answer / failed / hung up → recover
 *   POST /transfer/office-amd     → AMD callback: voicemail/machine → recover
 *   POST /transfer/recover        → caller leg: apologise and offer a callback
 *   POST /transfer/recover-choice → caller's callback/message choice
 *
 * The caller's own CallSid names the conference, and is how recovery finds the caller:
 * a held caller is in a conference that hasn't started, which the Participants API
 * doesn't reliably list, so recovery redirects the caller's call directly.
 *
 * Env: OFFICE_PHONE_NUMBER — the E.164 number this dials.
 */

import type { FastifyInstance } from 'fastify'
import twilio from 'twilio'
import type VoiceResponse from 'twilio/lib/twiml/VoiceResponse.js'
import { createStudioHandoffTool } from 'twilio-agent-connect'

import type { Tool } from '../llm/index.js'
import { emitEvent } from '../observability.js'
import { CallContext, orchestrated, publicUrl, requireTwilioSignature, studioHandoffEnabled, tac, voiceChannel } from '../tac/index.js'
import { linkCalls, markTransferred } from '../transcripts/store.js'
import { getClient } from '../twilioClient.js'

// The handoff reason code `transfer_to_human` sends and `/transfer/action` catches.
const HANDOFF_REASON_CODE = 'warm-transfer'
const OFFICE_FALLBACK_REASON = 'A caller is holding to speak with the office.'
const TRANSFER_ACTION_PATH = '/transfer/action'

/** The relay `<Connect action>` URL — undefined when the Studio flow owns the handoff. */
export const RELAY_ACTION_URL = studioHandoffEnabled ? undefined : publicUrl(TRANSFER_ACTION_PATH)

interface PendingTransfer {
  reason: string
  callerSid: string
  /** Set once the caller is redirected out of hold, so recovery runs only once. */
  recovered?: boolean
  bridged?: boolean
}

// Per-transfer state keyed by conference name — set when the caller is parked, read by
// the office leg so neither the reason nor the caller's CallSid travels in query
// strings. In a multi-instance deployment this would be a shared store.
const PENDING = new Map<string, PendingTransfer>()

function conferenceName(callSid: string): string {
  return `warm-transfer-${callSid}`
}

function parseHandoff(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

/** Queue a warm-transfer handoff for this call. */
export function transferToHuman({ reason }: { reason: string }, ctx: CallContext) {
  if (!process.env.OFFICE_PHONE_NUMBER) {
    return { transferred: false, instruction: "Transfers aren't set up. Apologise and offer to take a message." }
  }
  ctx.requestHandoff({
    reasonCode: HANDOFF_REASON_CODE,
    reason: reason || OFFICE_FALLBACK_REASON,
    // The Orchestrator conversation the AI portion lives in, so the human portion can
    // be transcribed into it too. Absent in ConversationRelay-only mode.
    ...(orchestrated && { conversationId: ctx.conversationId }),
  })
  return { transferred: true, instruction: 'Tell the caller you are connecting them now, in one short sentence.' }
}

const TRANSFER_DESCRIPTION =
  'Hand the caller to a person at the office. Call this when the caller asks for a human, or needs help you cannot give or are not allowed to give.'

const REASON_PARAMETERS = {
  type: 'object' as const,
  properties: {
    reason: {
      type: 'string',
      description: 'One short line for the office about what the caller needs. No dates of birth or other identifiers.',
    },
  },
  required: ['reason'],
}

/** Hand off through TAC's Studio flow: it sets the session's pending `end` frame. */
async function studioHandoff({ reason }: { reason: string }, ctx: CallContext) {
  const tool = createStudioHandoffTool(tac, ctx.session)
  return tool.implementation({ reason })
}

export const TOOLS: Tool<CallContext>[] = [
  {
    name: 'transfer_to_human',
    description: TRANSFER_DESCRIPTION,
    parameters: REASON_PARAMETERS,
    run: (args: { reason: string }, ctx: CallContext) =>
      studioHandoffEnabled ? studioHandoff(args, ctx) : transferToHuman(args, ctx),
  },
]

/** Place the office leg, with AMD and a status callback so every failure recovers the caller. */
export async function beginTransfer(conference: string): Promise<string> {
  // https://www.twilio.com/docs/voice/api/call-resource#create-a-call-resource
  // https://www.twilio.com/docs/voice/answering-machine-detection
  const call = await getClient().calls.create({
    to: process.env.OFFICE_PHONE_NUMBER!,
    from: process.env.TWILIO_PHONE_NUMBER!,
    url: publicUrl(`/transfer/office-answer?conference=${conference}`),
    timeout: 25,
    statusCallback: publicUrl(`/transfer/office-status?conference=${conference}`),
    statusCallbackEvent: ['completed'],
    machineDetection: 'DetectMessageEnd',
    asyncAmd: 'true',
    asyncAmdStatusCallback: publicUrl(`/transfer/office-amd?conference=${conference}`),
  })
  return call.sid
}

/** Move the parked caller out of hold to the recovery prompt — at most once per transfer. */
async function recoverCaller(conference: string): Promise<void> {
  const pending = PENDING.get(conference)
  if (!pending || pending.recovered || pending.bridged) return
  pending.recovered = true
  try {
    // https://www.twilio.com/docs/voice/api/call-resource#update-a-call-resource
    await getClient()
      .calls(pending.callerSid)
      .update({ url: publicUrl('/transfer/recover'), method: 'POST' })
    emitEvent('warmTransfer', 'recoverCaller', 'success', { correlationId: pending.callerSid })
  } catch (err) {
    // The caller already hung up — nothing to recover.
    emitEvent('warmTransfer', 'recoverCaller', 'error', { correlationId: pending.callerSid, status: 'error' })
    console.warn('warmTransfer: could not redirect caller', err instanceof Error ? err.message : err)
  } finally {
    PENDING.delete(conference)
  }
}

type Form = Record<string, string | undefined>
type Query = { conference?: string; decline?: string }

const xml = (response: twilio.twiml.VoiceResponse) => response.toString()

export async function routes(app: FastifyInstance): Promise<void> {
  const signed = { preHandler: requireTwilioSignature }

  app.post<{ Body: Form }>(TRANSFER_ACTION_PATH, signed, async (req, reply) => {
    // ConversationRelay `action` URL — fired when the relay session ends. This route
    // replaces TAC's own action callback, so pass the payload on for TAC's session
    // cleanup first. On a warm-transfer handoff: park the caller and dial the office.
    // Any other session end (normal hang-up) just releases the call.
    await voiceChannel.handleTwilioProviderCallback(req.body ?? {}).catch((err) => {
      console.warn('warmTransfer: TAC relay callback failed', err instanceof Error ? err.message : err)
    })
    const handoff = parseHandoff(req.body?.HandoffData)
    const callerSid = String(req.body?.CallSid ?? '')
    const response = new twilio.twiml.VoiceResponse()
    reply.type('text/xml')

    if (handoff.reasonCode !== HANDOFF_REASON_CODE || !callerSid) {
      response.hangup()
      return xml(response)
    }

    const conference = conferenceName(callerSid)
    PENDING.set(conference, { reason: handoff.reason ?? OFFICE_FALLBACK_REASON, callerSid })
    try {
      const officeSid = await beginTransfer(conference)
      // The office leg is its own captured conversation; file it under this caller's
      // transcript so the human portion shows on the same call.
      linkCalls(callerSid, officeSid)
      emitEvent('warmTransfer', 'beginTransfer', 'success', { correlationId: callerSid })
    } catch (err) {
      // Couldn't even place the office leg — tell the caller now instead of parking them.
      PENDING.delete(conference)
      emitEvent('warmTransfer', 'beginTransfer', 'error', { correlationId: callerSid, status: 'error' })
      console.error('warmTransfer: failed to dial office', err)
      response.redirect(publicUrl('/transfer/recover'))
      return xml(response)
    }

    // Transcribe the human portion into the same conversation as the AI portion:
    // ConversationRelay's transcription ended with the relay session, so start
    // Real-Time Transcription on the caller's leg, routed by conversationId. Both
    // tracks: inbound is the caller, outbound is everyone else in the conference (the
    // office once bridged). One STT engine at a time — never both on this call.
    // https://www.twilio.com/docs/conversations/orchestrator/concepts/ingestion
    if (handoff.conversationId?.startsWith('conv_conversation_')) {
      // `conversationId` is a documented <Transcription> attribute the SDK's types don't
      // list yet; the SDK passes it through to the TwiML as-is.
      const attributes: VoiceResponse.TranscriptionAttributes & { conversationId: string } = {
        conversationId: handoff.conversationId,
        track: 'both_tracks',
        inboundTrackLabel: 'customer',
        outboundTrackLabel: 'office',
      }
      response.start().transcription(attributes)
    }

    // Park the caller: they wait on hold until the office joins and starts the room.
    // endConferenceOnExit=true so hang-up tears the room down.
    // https://www.twilio.com/docs/voice/twiml/conference
    response
      .dial()
      .conference({ startConferenceOnEnter: false, endConferenceOnExit: true, beep: 'false' }, conference)
    return xml(response)
  })

  app.post<{ Querystring: Query }>('/transfer/office-answer', signed, async (req, reply) => {
    // Office leg answered — state the reason and gather a keypress to accept.
    const conference = String(req.query.conference ?? '')
    const reason = PENDING.get(conference)?.reason ?? OFFICE_FALLBACK_REASON

    const response = new twilio.twiml.VoiceResponse()
    const gather = response.gather({
      numDigits: 1,
      timeout: 10,
      action: publicUrl(`/transfer/office-gather?conference=${conference}`),
    })
    gather.say(`${reason} Press 1 to accept the call, or hang up to decline.`)
    // No input → fall through to a decline, which recovers the caller.
    response.redirect(publicUrl(`/transfer/office-gather?conference=${conference}&decline=1`))
    reply.type('text/xml')
    return xml(response)
  })

  app.post<{ Body: Form; Querystring: Query }>('/transfer/office-gather', signed, async (req, reply) => {
    // Office pressed a key — bridge into the caller's conference on 1, else decline.
    const conference = String(req.query.conference ?? '')
    const pending = PENDING.get(conference)
    const response = new twilio.twiml.VoiceResponse()
    reply.type('text/xml')

    if (String(req.body?.Digits ?? '') === '1' && pending && !pending.recovered) {
      // Join the caller's room and start it — hold music stops, the two are bridged.
      pending.bridged = true
      PENDING.delete(conference)
      markTransferred(pending.callerSid)
      response
        .dial()
        .conference({ startConferenceOnEnter: true, endConferenceOnExit: true, beep: 'false' }, conference)
      return xml(response)
    }

    await recoverCaller(conference)
    response.say(pending ? 'No problem — goodbye.' : 'The caller is no longer waiting. Goodbye.')
    response.hangup()
    return xml(response)
  })

  app.post<{ Body: Form; Querystring: Query }>('/transfer/office-status', signed, async (req, reply) => {
    // Office leg finished. If it never bridged (busy, no-answer, failed, canceled, or
    // answered and hung up before pressing 1), bring the caller back.
    await recoverCaller(String(req.query.conference ?? ''))
    reply.code(204)
    return ''
  })

  app.post<{ Body: Form; Querystring: Query }>('/transfer/office-amd', signed, async (req, reply) => {
    // AMD result — a machine/voicemail answered the office leg. Hang it up and recover
    // the caller. https://www.twilio.com/docs/voice/answering-machine-detection
    const conference = String(req.query.conference ?? '')
    const answeredBy = String(req.body?.AnsweredBy ?? '')
    const officeCallSid = String(req.body?.CallSid ?? '')
    if (answeredBy.startsWith('machine') || answeredBy === 'fax') {
      await recoverCaller(conference)
      if (officeCallSid) {
        await getClient()
          .calls(officeCallSid)
          .update({ status: 'completed' })
          .catch(() => undefined) // already ended
      }
    }
    reply.code(204)
    return ''
  })

  app.post('/transfer/recover', signed, async (_req, reply) => {
    // Caller leg after a failed transfer — apologise and offer a callback or message.
    const response = new twilio.twiml.VoiceResponse()
    const gather = response.gather({ numDigits: 1, timeout: 8, action: publicUrl('/transfer/recover-choice') })
    gather.say(
      "I'm sorry — the office isn't available right now. Press 1 to request a callback, or 2 to leave a message.",
    )
    response.say("I didn't catch that. Please call again later. Goodbye.")
    response.hangup()
    reply.type('text/xml')
    return xml(response)
  })

  app.post<{ Body: Form }>('/transfer/recover-choice', signed, async (req, reply) => {
    // Record the caller's callback/message choice. Stubbed: acknowledge and hang up.
    // Wire this to your callback queue or voicemail backend — and keep recordings,
    // which may contain PHI, on a HIPAA-eligible account under a BAA.
    const digit = String(req.body?.Digits ?? '')
    const response = new twilio.twiml.VoiceResponse()
    if (digit === '1') {
      response.say("Thanks — we'll call you back as soon as the office is free. Goodbye.")
    } else if (digit === '2') {
      response.say('Please leave your message after the tone.')
      response.record({ maxLength: 120, playBeep: true })
    } else {
      response.say('No problem. Please call again later. Goodbye.')
    }
    response.hangup()
    reply.type('text/xml')
    return xml(response)
  })
}
