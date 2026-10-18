/**
 * Live call transcripts from Conversation Orchestrator status callbacks.
 *
 * Routes (exported as `routes`, listed in `src/handlers/` and registered by app.ts):
 *   POST /transcripts/webhook → Orchestrator status callback (signed JSON, bodySHA256)
 *   GET  /calls               → recent calls with their transcripts   (local only)
 *   GET  /calls/stream        → Server-Sent Events: snapshot, then live deltas (local only)
 *
 * Add `https://<PUBLIC_HOST>/transcripts/webhook` to the configuration's
 * `statusCallbacks` (`npm run add-status-callback`). TAC's own `/webhook` stays as-is —
 * its voice channel needs those events for session cleanup.
 *
 * Event order isn't guaranteed, and a conversation's Call SID first appears on its
 * communications (`channelId`). Participants seen before that are kept per
 * conversation and applied once the conversation is tied to a call.
 *
 * Docs: https://www.twilio.com/docs/conversations/orchestrator/webhooks
 */

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import twilio from 'twilio'

import { emitEvent } from '../observability.js'
import { publicUrl, tac } from '../tac/index.js'
import {
  addLine,
  callForConversation,
  endCall,
  recentCalls,
  speakerFor,
  subscribe,
  trackConversation,
  upsertParticipant,
} from './store.js'

const WEBHOOK_PATH = '/transcripts/webhook'
const HEARTBEAT_MS = 15_000

interface Webhook {
  eventType?: string
  timestamp?: string
  data?: Record<string, any>
}

/** Only this app's configuration — the shared config also captures other demos' numbers. */
const CONFIGURATION_ID = tac.getConfig().conversationConfigurationId

/** Conversations that closed before their first communication tied them to a call. */
const closedBeforeTracked = new Set<string>()

function handleConversation(data: Record<string, any>, at: string): void {
  if (CONFIGURATION_ID && data.configurationId && data.configurationId !== CONFIGURATION_ID) return
  if (data.status !== 'CLOSED') return
  const call = callForConversation(data.id)
  if (!call) closedBeforeTracked.add(data.id)
  else if (call.leg === 'caller') endCall(call.callSid, data.updatedAt ?? at)
}

function handleParticipant(data: Record<string, any>): void {
  const address = (data.addresses as Array<{ address?: string; channel?: string }> | undefined)?.find(
    (a) => a.channel === 'VOICE' || !a.channel,
  )?.address
  upsertParticipant(data.id, data.conversationId, data.type ?? null, address ?? null)
}

function handleCommunication(data: Record<string, any>, at: string): void {
  const content = data.content as { type?: string; text?: string } | undefined
  if (content?.type !== 'TRANSCRIPTION' || !content.text?.trim()) return
  const callSid = String(data.channelId ?? '')
  if (!callSid.startsWith('CA')) return

  trackConversation(data.conversationId, callSid, data.occurredAt ?? at)
  const call = callForConversation(data.conversationId)!
  if (closedBeforeTracked.delete(data.conversationId) && call.leg === 'caller') endCall(call.callSid, at)

  addLine({
    id: data.id,
    callSid: call.callSid,
    conversationId: data.conversationId,
    at: data.occurredAt ?? data.createdAt ?? at,
    speaker: speakerFor(data.author?.participantId, data.author?.address, data.conversationId),
    text: content.text.trim(),
  })
}

/** Reject requests that didn't come from this machine — transcripts can hold PHI. */
async function localOnly(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  const ip = req.socket.remoteAddress ?? ''
  const forwarded = req.headers['x-forwarded-for'] || req.headers['x-forwarded-host']
  if (forwarded || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) {
    await reply.code(403).send({ error: 'local only' })
  }
}

export async function routes(app: FastifyInstance): Promise<void> {
  // Orchestrator signs JSON webhooks over the raw body (bodySHA256), so keep it. Scoped
  // to this plugin: TACServer installs its own raw-body parser only at start(), after
  // this plugin is registered, and that one doesn't reach routes registered earlier.
  app.removeContentTypeParser('application/json')
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    ;(req as FastifyRequest & { rawBody?: string }).rawBody = body as string
    try {
      done(null, body ? JSON.parse(body as string) : {})
    } catch (err) {
      done(err as Error, undefined)
    }
  })

  app.post<{ Body: Webhook }>(WEBHOOK_PATH, async (req, reply) => {
    // https://www.twilio.com/docs/usage/webhooks/webhooks-security
    const signature = req.headers['x-twilio-signature'] as string | undefined
    const rawBody = (req as FastifyRequest & { rawBody?: string }).rawBody ?? ''
    if (!signature || !twilio.validateRequestWithBody(tac.getConfig().authToken, signature, publicUrl(req.url), rawBody)) {
      return reply.code(403).send({ error: 'invalid signature' })
    }

    const { eventType, data, timestamp } = req.body ?? {}
    const at = timestamp ?? new Date().toISOString()
    try {
      if (data) {
        if (eventType === 'CONVERSATION_CREATED' || eventType === 'CONVERSATION_UPDATED') handleConversation(data, at)
        else if (eventType === 'PARTICIPANT_ADDED' || eventType === 'PARTICIPANT_UPDATED') handleParticipant(data)
        else if (eventType === 'COMMUNICATION_CREATED') handleCommunication(data, at)
      }
    } catch (err) {
      // Never make Orchestrator retry because of our bookkeeping.
      console.error('transcripts: failed to handle', eventType, err)
      emitEvent('transcripts', String(eventType), 'error', { status: 'error' })
    }
    return reply.code(200).send({ status: 'ok' })
  })

  app.get('/calls', { preHandler: localOnly }, async () => recentCalls())

  app.get('/calls/stream', { preHandler: localOnly }, (req, reply) => {
    reply.hijack()
    const res = reply.raw
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    const send = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

    send('snapshot', recentCalls())
    const unsubscribe = subscribe((e) => send(e.type, e.type === 'call' ? e.call : e.line))
    const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
    req.raw.on('close', () => {
      clearInterval(heartbeat)
      unsubscribe()
    })
  })
}
