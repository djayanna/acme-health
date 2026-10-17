/**
 * Channels — Twilio Voice / SMS entry points, outbound dispatch and webhook security.
 *
 * Public surface:
 *   placeCall(to, twiml, statusCallback?) -> Promise<string>   // outbound voice, returns CallSid
 *   verifySignature(url, params, header) -> boolean
 *   verifyJsonSignature(url, rawBody, header) -> boolean
 *   voiceResponse() / messagingResponse()                      // TwiML builders
 *   registerSmsHandler(fn)
 *   onCallCompleted(fn)
 *   publicUrl(path) -> string
 *
 * Routes (exported as `router`, mounted by app.ts):
 *   POST /sms/inbound   → the registered SMS handler
 *   POST /voice/status  → fans `completed` out to onCallCompleted callbacks
 *
 * `POST /voice/inbound` is not owned by Channels — it belongs to the voice component
 * in scope (e.g. ConversationRelay).
 *
 * Docs: https://www.twilio.com/docs/voice/api/call-resource ·
 * https://www.twilio.com/docs/usage/security
 */

import { Router, type Request } from 'express'
import twilio from 'twilio'

import { getClient } from '../twilioClient.js'

export type Params = Record<string, string>

export type SmsHandler = (
  params: Params,
) => twilio.twiml.MessagingResponse | null | Promise<twilio.twiml.MessagingResponse | null>

export type CallCompletedHandler = (callSid: string, params: Params) => void | Promise<void>

const STATUS_CALLBACK_PATH = '/voice/status'

let smsHandler: SmsHandler | null = null
const callCompletedHandlers: CallCompletedHandler[] = []


/**
 * Dial `to` from TWILIO_PHONE_NUMBER and run `twiml` when it is answered.
 *
 * `statusCallback` defaults to this app's `/voice/status`, so `onCallCompleted`
 * callbacks fire when the call ends. Resolves to the new CallSid.
 */
export async function placeCall(to: string, twiml: string, statusCallback?: string): Promise<string> {
  // Programmable Voice — create an outbound call.
  // https://www.twilio.com/docs/voice/api/call-resource#create-a-call-resource
  const call = await getClient().calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER!,
    twiml,
    statusCallback: statusCallback ?? publicUrl(STATUS_CALLBACK_PATH),
    statusCallbackEvent: ['completed'],
  })
  return call.sid
}


export function registerSmsHandler(fn: SmsHandler): SmsHandler {
  smsHandler = fn
  return fn
}

export function onCallCompleted(fn: CallCompletedHandler): CallCompletedHandler {
  callCompletedHandlers.push(fn)
  return fn
}

export function voiceResponse(): twilio.twiml.VoiceResponse {
  return new twilio.twiml.VoiceResponse()
}

export function messagingResponse(): twilio.twiml.MessagingResponse {
  return new twilio.twiml.MessagingResponse()
}

export function verifySignature(url: string, params: Params, signatureHeader: string | undefined): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken || !signatureHeader) {
    console.warn('channels: refusing webhook — missing TWILIO_AUTH_TOKEN or signature header')
    return false
  }
  return twilio.validateRequest(authToken, signatureHeader, url, params)
}

/**
 * Validate the `X-Twilio-Signature` of a webhook that POSTs a JSON body.
 *
 * For JSON webhooks Twilio appends a `bodySHA256` query parameter to the URL, so
 * `url` must be the full URL including that query string, and `rawBody` the
 * unparsed request body. https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyJsonSignature(url: string, rawBody: string, signatureHeader: string | undefined): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken || !signatureHeader) {
    console.warn('channels: refusing webhook — missing TWILIO_AUTH_TOKEN or signature header')
    return false
  }
  return twilio.validateRequestWithBody(authToken, signatureHeader, url, rawBody)
}

export function publicUrl(path: string): string {
  let host = (process.env.PUBLIC_HOST ?? '').trim().replace(/\/+$/, '')
  if (host && !/^https?:\/\//i.test(host)) host = `https://${host}`
  return host ? `${host}${path}` : path
}

export async function dispatchSms(params: Params): Promise<twilio.twiml.MessagingResponse | null> {
  if (!smsHandler) {
    console.info('channels: inbound SMS received, no handler registered')
    return null
  }
  return (await smsHandler(params)) ?? null
}

export async function dispatchCallCompleted(callSid: string, params: Params): Promise<void> {
  for (const callback of callCompletedHandlers) {
    try {
      await callback(callSid, params)
    } catch (err) {
      console.error('channels: onCallCompleted callback failed', err)
    }
  }
}

/** The request's form params, or null when the Twilio signature doesn't match. */
function signedForm(req: Request, path: string): Params | null {
  const params = req.body as Params
  return verifySignature(publicUrl(path), params, req.header('X-Twilio-Signature') ?? undefined) ? params : null
}

export const router = Router()


router.post('/sms/inbound', async (req, res) => {
  // Twilio Messaging webhook — verifies the signature, hands off to the SMS handler.
  const params = signedForm(req, '/sms/inbound')
  if (!params) {
    res.status(403).type('text/plain').send('invalid signature')
    return
  }
  const reply = await dispatchSms(params)
  res.type('text/xml').send(reply ? reply.toString() : '<Response/>')
})


router.post(STATUS_CALLBACK_PATH, async (req, res) => {
  // Twilio Voice status callback — `placeCall` sets this URL automatically; for
  // inbound calls set the number's Status Callback URL to `<PUBLIC_HOST>/voice/status`.
  const params = signedForm(req, STATUS_CALLBACK_PATH)
  if (!params) {
    res.status(403).type('text/plain').send('invalid signature')
    return
  }
  if (params.CallStatus === 'completed') {
    await dispatchCallCompleted(params.CallSid ?? '', params)
  }
  res.status(204).end()
})

