/**
 * Warm transfer to a human over the PSTN.
 *
 * Parks the caller in a per-call conference on hold, dials the office on a second
 * leg, confirms with a keypress, then bridges the two. Declines / no-answer /
 * voicemail fall back to the caller with an apology.
 *
 * Routes (exported as `router`, listed in `src/handlers/` and mounted by app.ts):
 *   POST /transfer/action         → ConversationRelay `action` URL: park + dial office
 *   POST /transfer/office-answer  → office answered: say reason, gather accept
 *   POST /transfer/office-gather  → office keypress: bridge (1) or recover
 *   POST /transfer/office-amd     → AMD callback: voicemail/machine → recover
 *   POST /transfer/recover        → caller leg: apologise and offer a callback
 *   POST /transfer/recover-choice → caller's callback/message choice
 *
 * Tool (exported in `TOOLS`, collected into `SHARED_TOOLS` by `src/tools/`):
 *   transfer_to_human(reason) → ends the ConversationRelay session with
 *     `handoffData = {reasonCode: "warm-transfer", reason}`; Twilio then POSTs the
 *     relay `action` URL (`/transfer/action`) and the routes above take over.
 *
 * The caller's own CallSid names the conference, so the office leg can be bridged
 * into the right room.
 *
 * Env: OFFICE_PHONE_NUMBER — the E.164 number this dials; RELAY_ACTION_URL — this
 * `/transfer/action` route's public URL, passed as the relay `action` URL.
 */

import { Router, type Request } from 'express'
import twilio from 'twilio'

import { publicUrl } from '../channels/index.js'
import type { Tool } from '../llm/index.js'
import type { RelayToolCtx } from '../relay/index.js'
import { getClient } from '../twilioClient.js'

export const router = Router()

// The handoff reason code `transferToHuman` sends and `/transfer/action` catches.
const HANDOFF_REASON_CODE = 'warm-transfer'
const OFFICE_FALLBACK_REASON = 'A caller is holding to speak with the office.'

// Per-transfer context keyed by conference name — set when the caller is parked, read
// by the office leg so the reason doesn't travel through query strings. In a
// multi-instance deployment this would be a shared store (Redis, the events DB).
const PENDING = new Map<string, { reason: string }>()

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


const NO_TRANSFER_REPLY =
  "I'm sorry, I can't connect you right now, but I can take a message or help you another way."

/** End the relay session for a warm transfer; Twilio then POSTs `/transfer/action`.
 * With no RELAY_ACTION_URL nothing would catch the handoff, so the agent apologises
 * and stays on the line instead. */
export function transferToHuman({ reason }: { reason?: string }, ctx: RelayToolCtx) {
  if (!process.env.RELAY_ACTION_URL) {
    ctx.say(NO_TRANSFER_REPLY)
    return { transferred: false, reason: 'RELAY_ACTION_URL is not set' }
  }
  ctx.end({ reasonCode: HANDOFF_REASON_CODE, reason: reason || OFFICE_FALLBACK_REASON })
  return { transferred: true }
}

export const TOOLS: Tool<RelayToolCtx>[] = [
  {
    name: 'transfer_to_human',
    description:
      'Hand the caller to a person at the office. Call this when the caller asks for a human, or needs help you cannot give or are not allowed to give.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'One short, non-sensitive line the office hears before accepting the call.',
        },
      },
      required: ['reason'],
    },
    run: transferToHuman,
  },
]


router.post('/transfer/action', async (req, res) => {
  // ConversationRelay `action` URL — fired when the relay session ends. On a
  // warm-transfer handoff: park the caller and dial the office. Any other session
  // end (normal hang-up) just releases the call.
  const handoff = parseHandoff(req.body?.HandoffData)
  const callerSid = String(req.body?.CallSid ?? '')

  const response = new twilio.twiml.VoiceResponse()
  if (handoff.reasonCode !== HANDOFF_REASON_CODE) {
    response.hangup()
    res.type('text/xml').send(response.toString())
    return
  }

  const conference = conferenceName(callerSid)
  PENDING.set(conference, { reason: handoff.reason ?? OFFICE_FALLBACK_REASON })
  await beginTransfer(conference)

  // Park the caller: they wait on hold until the office joins and starts the room.
  // endConferenceOnExit=true so hang-up tears the room down.
  // https://www.twilio.com/docs/voice/twiml/conference
  response
    .dial()
    .conference(
      { startConferenceOnEnter: false, endConferenceOnExit: true, beep: 'false' },
      conference,
    )
  res.type('text/xml').send(response.toString())
})

export async function beginTransfer(conference: string): Promise<string> {
  // Place the office leg with Answering Machine Detection. The office leg runs
  // /transfer/office-answer when answered; AMD routes machines/voicemail to recovery.
  // https://www.twilio.com/docs/voice/answering-machine-detection
  const call = await getClient().calls.create({
    to: process.env.OFFICE_PHONE_NUMBER!,
    from: process.env.TWILIO_PHONE_NUMBER!,
    url: publicUrl(`/transfer/office-answer?conference=${conference}`),
    machineDetection: 'DetectMessageEnd',
    asyncAmd: 'true',
    asyncAmdStatusCallback: publicUrl(`/transfer/office-amd?conference=${conference}`),
  })
  return call.sid
}


router.post('/transfer/office-answer', (req, res) => {
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
  res.type('text/xml').send(response.toString())
})

router.post('/transfer/office-gather', async (req, res) => {
  // Office pressed a key — bridge into the caller's conference on 1, else decline.
  const conference = String(req.query.conference ?? '')
  const digit = String(req.body?.Digits ?? '')

  const response = new twilio.twiml.VoiceResponse()
  if (digit === '1') {
    // Join the caller's room and start it — hold music stops, the two are bridged.
    PENDING.delete(conference)
    response
      .dial()
      .conference(
        { startConferenceOnEnter: true, endConferenceOnExit: true, beep: 'false' },
        conference,
      )
  } else {
    await recoverCaller(conference)
    response.say('No problem — goodbye.')
    response.hangup()
  }
  res.type('text/xml').send(response.toString())
})

router.post('/transfer/office-amd', async (req, res) => {
  // AMD status callback — a machine/voicemail answered the office leg. Hang it up and
  // recover the caller.
  const conference = String(req.query.conference ?? '')
  const answeredBy = String(req.body?.AnsweredBy ?? '')
  const officeCallSid = String(req.body?.CallSid ?? '')
  if (answeredBy.startsWith('machine') || answeredBy === 'fax') {
    if (officeCallSid) await getClient().calls(officeCallSid).update({ status: 'completed' })
    await recoverCaller(conference)
  }
  res.type('text/xml').send('')
})


async function recoverCaller(conference: string): Promise<void> {
  // Redirect the parked caller's leg to the recovery TwiML. The caller is the only
  // remaining participant; redirecting them out of the conference ends the hold.
  PENDING.delete(conference)
  const participants = await getClient().conferences(conference).participants.list({ limit: 1 })
  for (const participant of participants) {
    await getClient()
      .calls(participant.callSid)
      .update({ url: publicUrl('/transfer/recover'), method: 'POST' })
  }
}

router.post('/transfer/recover', (_req, res) => {
  // Caller leg after a failed transfer — apologise and offer a callback or message.
  const response = new twilio.twiml.VoiceResponse()
  const gather = response.gather({ numDigits: 1, timeout: 8, action: publicUrl('/transfer/recover-choice') })
  gather.say(
    "I'm sorry — the office isn't available right now. " +
      'Press 1 to request a callback, or 2 to leave a message.',
  )
  response.say("I didn't catch that. Please call again later. Goodbye.")
  response.hangup()
  res.type('text/xml').send(response.toString())
})

router.post('/transfer/recover-choice', (req, res) => {
  // Record the caller's callback/message choice. Stubbed: acknowledge and hang up.
  // Wire this to your callback queue or voicemail (<Record>) backend.
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
  res.type('text/xml').send(response.toString())
})

