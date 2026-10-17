/**
 * Twilio access layer — SDK-or-REST, same interface either way.
 *
 * SDK mode: uses the official Twilio Node helper library.
 *
 * Auth precedence: API key + secret (recommended for production) → Account SID +
 * Auth Token (dev/trial). Credentials are read from environment variables — see
 * `.env.example`.
 *
 * Docs: https://www.twilio.com/docs
 */

import twilio, { type Twilio } from 'twilio'

function require_(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`missing environment variable: ${name}`)
  return value
}

let cached: Twilio | undefined

export function getClient(): Twilio {
  if (cached) return cached
  const accountSid = require_('TWILIO_ACCOUNT_SID')
  const apiKey = process.env.TWILIO_API_KEY
  const apiSecret = process.env.TWILIO_API_SECRET
  if (apiKey && apiSecret) {
    cached = twilio(apiKey, apiSecret, { accountSid })
  } else {
    cached = twilio(accountSid, require_('TWILIO_AUTH_TOKEN'))
  }
  return cached
}
