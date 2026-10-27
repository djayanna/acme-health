/**
 * Twilio Agent Connect (TAC) — the app's single TAC instance and voice channel.
 *
 * TAC owns the ConversationRelay plumbing: the inbound TwiML (`POST /twiml`), the
 * WebSocket Twilio streams the call over, prompt queueing, interrupt cancellation and
 * Twilio signature validation on every route `TACServer` registers.
 *
 * Mode is picked by the environment, not the code:
 *   TWILIO_CONVERSATION_CONFIGURATION_ID set   → orchestrated: Conversation Orchestrator
 *     + Conversation Memory (profile, observations, summaries) are on.
 *   TWILIO_CONVERSATION_CONFIGURATION_ID unset → ConversationRelay-only: voice works with
 *     plain Twilio credentials; memory, knowledge and the Studio handoff are off.
 * Everything that depends on the mode checks the flags exported here.
 *
 * Docs: https://www.twilio.com/docs/conversations/agent-connect/overview
 */

import type { FastifyReply, FastifyRequest } from 'fastify'
import twilio from 'twilio'
import { TAC, TACConfig, VoiceChannel } from 'twilio-agent-connect'

export { CallContext } from './callContext.js'
import { logRelayFrames } from './relayLog.js'

/** Absolute public URL for `path` on PUBLIC_HOST — what Twilio calls and signs. */
export function publicUrl(path: string): string {
  let host = (process.env.PUBLIC_HOST ?? '').trim().replace(/\/+$/, '')
  if (host && !/^https?:\/\//i.test(host)) host = `https://${host}`
  return host ? `${host}${path}` : path
}

// TAC validates optional IDs by format, and treats an empty string as a (malformed)
// value. `.env.example` ships these empty, so drop blanks to mean "not set".
for (const name of [
  'TWILIO_CONVERSATION_CONFIGURATION_ID',
  'TWILIO_STUDIO_HANDOFF_FLOW_SID',
  'TWILIO_RCS_SENDER_ID',
  'TWILIO_WHATSAPP_NUMBER',
  'TWILIO_REGION',
]) {
  if (!process.env[name]?.trim()) delete process.env[name]
}

// TAC reads its public domain (no scheme) from TWILIO_VOICE_PUBLIC_DOMAIN; the rest of
// the app uses PUBLIC_HOST. Default one from the other so .env only needs PUBLIC_HOST.
process.env.TWILIO_VOICE_PUBLIC_DOMAIN ||= (process.env.PUBLIC_HOST ?? '').replace(/^https?:\/\//i, '')

export const tac = await TAC.create({ config: TACConfig.fromEnv() })

/** True when Conversation Orchestrator (and with it Conversation Memory) is configured. */
export const orchestrated = Boolean(tac.getConfig().conversationConfigurationId)

/** TAC's Studio handoff needs Orchestrator plus a Studio flow; otherwise use the warm transfer. */
export const studioHandoffEnabled = orchestrated && Boolean(tac.getConfig().studioHandoffFlowSid)

export const voiceChannel = new VoiceChannel(tac, {
  // Fetch the caller's memory once at call start and reuse it every turn, so the
  // system prompt stays identical for the whole call. Relay-only mode has no memory.
  memoryMode: orchestrated ? 'once' : 'never',
})
tac.registerChannel(voiceChannel)
// Log every ConversationRelay frame (setup, prompt, interrupt, dtmf, error) — see relayLog.ts.
logRelayFrames(tac, voiceChannel)

/**
 * Fastify `preHandler` that rejects a request whose `X-Twilio-Signature` doesn't match.
 *
 * TACServer validates the routes it registers itself; this covers the app's own Twilio
 * webhooks. The signed URL is the public URL including the query string.
 */
export async function requireTwilioSignature(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  // https://www.twilio.com/docs/usage/webhooks/webhooks-security
  const signature = req.headers['x-twilio-signature'] as string | undefined
  const params = (req.body ?? {}) as Record<string, string>
  const authToken = tac.getConfig().authToken
  if (!signature || !twilio.validateRequest(authToken, signature, publicUrl(req.url), params)) {
    await reply.code(403).type('text/plain').send('invalid signature')
  }
}
