/**
 * Give acme-health its own Conversation Orchestrator configuration with passive VOICE
 * capture on TWILIO_PHONE_NUMBER, and move the number's capture rules off the shared
 * configuration in TWILIO_CONVERSATION_CONFIGURATION_ID.
 *
 *   npm run create-voice-config            # show what would be created / changed
 *   npm run create-voice-config -- --apply # do it
 *
 * Why a new configuration: `conversationGroupingType` can't be changed after creation
 * (https://www.twilio.com/docs/conversations/orchestrator/concepts/core); the shared one
 * was changed in place and its passive voice capture no longer provisions transcription
 * (error 32650). Capture rules must not overlap across configurations, so this number's
 * rules are removed from the shared one once the new one exists.
 *
 * The new configuration copies the shared one's Memory Store, Intelligence and memory
 * extraction, uses GROUP_BY_PARTICIPANT_ADDRESSES (what Agent Connect expects), and
 * sends status callbacks to TAC's /webhook and /transcripts/webhook. Afterwards, set
 * TWILIO_CONVERSATION_CONFIGURATION_ID in .env to the printed ID and restart.
 *
 * Configuration writes are async (202 + statusUrl):
 * https://www.twilio.com/docs/conversations/orchestrator/concepts/async-operations
 */

import 'dotenv/config'
import { randomUUID } from 'node:crypto'

const BASE = 'https://conversations.twilio.com/v2/ControlPlane/Configurations'
const DISPLAY_NAME = 'acme-health-voice'
const apply = process.argv.includes('--apply')

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`missing environment variable: ${name}`)
  return value
}

const sharedId = required('TWILIO_CONVERSATION_CONFIGURATION_ID')
const number = required('TWILIO_PHONE_NUMBER')
const host = required('PUBLIC_HOST').replace(/^https?:\/\//i, '').replace(/\/+$/, '')
const [user, pass] =
  process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET
    ? [process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET]
    : [required('TWILIO_ACCOUNT_SID'), required('TWILIO_AUTH_TOKEN')]
const headers = {
  Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
  'Content-Type': 'application/json',
}

type Rule = { from: string; to: string; metadata: Record<string, unknown> }
type Config = Record<string, any> & {
  id: string
  version: number
  displayName: string
  channelSettings: Record<string, { captureRules?: Rule[] | null; statusTimeouts?: unknown }>
}

async function api(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await fetch(url, {
    method,
    headers: { ...headers, ...extra },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url} → HTTP ${res.status}: ${text}`)
  return text ? JSON.parse(text) : {}
}

/** Poll an async operation until it finishes; returns its final body. */
async function waitFor(statusUrl: string, label: string): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((r) => setTimeout(r, 2000))
    const op = await api('GET', statusUrl)
    if (op.status === 'COMPLETED') return op
    if (op.status === 'FAILED') throw new Error(`${label} failed: ${JSON.stringify(op)}`)
  }
  throw new Error(`${label}: still pending after 60 s (${statusUrl})`)
}

const isOurs = (r: Rule) => r.from === number || r.to === number

const all = (await api('GET', BASE)).configurations as Array<{ id: string; displayName: string }>
const existing = all.find((c) => c.displayName === DISPLAY_NAME)
const shared: Config = await api('GET', `${BASE}/${sharedId}`)
const sharedVoice = shared.channelSettings.VOICE ?? {}
const ourRules = (sharedVoice.captureRules ?? []).filter(isOurs)
const keptRules = (sharedVoice.captureRules ?? []).filter((r) => !isOurs(r))

const newConfig = {
  displayName: DISPLAY_NAME,
  description: `acme-health voice agent: passive VOICE capture on ${number}`,
  conversationGroupingType: 'GROUP_BY_PARTICIPANT_ADDRESSES',
  memoryStoreId: shared.memoryStoreId,
  memoryExtractionEnabled: shared.memoryExtractionEnabled ?? false,
  intelligenceConfigurationIds: shared.intelligenceConfigurationIds ?? [],
  channelSettings: {
    VOICE: {
      captureRules: [
        { from: '*', to: number, metadata: {} },
        { from: number, to: '*', metadata: {} },
      ],
      // Close as soon as the final transcription event arrives (troubleshooting docs).
      statusTimeouts: null,
    },
  },
  statusCallbacks: [
    { url: `https://${host}/webhook`, method: 'POST' },
    { url: `https://${host}/transcripts/webhook`, method: 'POST' },
  ],
}

console.log(`shared configuration: ${shared.displayName} (${shared.id}) v${shared.version}`)
console.log(`  ${number} VOICE rules to move: ${ourRules.length}; other VOICE rules kept: ${keptRules.length}`)
console.log(existing ? `new configuration already exists: ${existing.id}` : 'new configuration to create:')
if (!existing) console.log(JSON.stringify({ ...newConfig, memoryStoreId: '<from shared>' }, null, 2))

if (!apply) {
  console.log('\ndry run — re-run with --apply to create it and remove the rules from the shared configuration')
  process.exit(0)
}

// 1. Create the dedicated configuration (idempotent per run via Idempotency-Key).
let newId = existing?.id
if (!newId) {
  const op = await api('POST', BASE, newConfig, { 'Idempotency-Key': randomUUID() })
  const done = await waitFor(op.statusUrl, 'create')
  newId = done.related?.configurationId ?? op.related?.configurationId
  if (!newId) {
    // Known limitation: the operation may complete without the ID — find it by name.
    const list = (await api('GET', BASE)).configurations as Array<{ id: string; displayName: string }>
    newId = list.find((c) => c.displayName === DISPLAY_NAME)?.id
  }
  if (!newId) throw new Error('created, but could not find the new configuration ID')
  console.log(`created ${DISPLAY_NAME}: ${newId}`)
}

// 2. Remove this number's VOICE rules from the shared configuration (no overlap).
if (ourRules.length) {
  const latest: Config = await api('GET', `${BASE}/${sharedId}`)
  const { id, createdAt, updatedAt, version, ...body } = latest
  const voice = latest.channelSettings.VOICE ?? {}
  body.channelSettings = {
    ...latest.channelSettings,
    VOICE: { ...voice, captureRules: (voice.captureRules ?? []).filter((r: Rule) => !isOurs(r)) },
  }
  const op = await api('PUT', `${BASE}/${sharedId}`, body)
  await waitFor(op.statusUrl, 'update shared')
  console.log(`removed ${ourRules.length} ${number} VOICE rules from ${latest.displayName}`)
}

const created: Config = await api('GET', `${BASE}/${newId}`)
console.log(`\n${created.displayName} v${created.version}: grouping ${created.conversationGroupingType}, VOICE rules ${created.channelSettings.VOICE?.captureRules?.length ?? 0}, callbacks ${(created.statusCallbacks ?? []).map((c: { url: string }) => c.url).join(', ')}`)
console.log(`\nNext: set TWILIO_CONVERSATION_CONFIGURATION_ID=${newId} in .env and restart the app.`)
