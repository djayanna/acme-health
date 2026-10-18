/**
 * Add this app's transcript webhook to the Conversation Orchestrator configuration's
 * `statusCallbacks`, keeping every existing callback.
 *
 *   npm run add-status-callback            # show the change, don't send it
 *   npm run add-status-callback -- --apply # send it
 *
 * The URL is https://<PUBLIC_HOST>/transcripts/webhook. Idempotent: does nothing if it's
 * already there. Run it again when PUBLIC_HOST changes (pass --replace to drop an older
 * /transcripts/webhook URL from another host).
 *
 * Configuration updates are a full replacement (PUT), so this re-fetches the current
 * configuration, changes only `statusCallbacks`, and sends the rest back unchanged.
 * https://www.twilio.com/docs/conversations/orchestrator/webhooks
 */

import 'dotenv/config'

const BASE = 'https://conversations.twilio.com/v2/ControlPlane/Configurations'
const PATH = '/transcripts/webhook'

const apply = process.argv.includes('--apply')
const replace = process.argv.includes('--replace')

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`missing environment variable: ${name}`)
  return value
}

const configId = required('TWILIO_CONVERSATION_CONFIGURATION_ID')
const host = required('PUBLIC_HOST').replace(/^https?:\/\//i, '').replace(/\/+$/, '')
const url = `https://${host}${PATH}`

const [user, pass] =
  process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET
    ? [process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET]
    : [required('TWILIO_ACCOUNT_SID'), required('TWILIO_AUTH_TOKEN')]
const headers = {
  Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`,
  'Content-Type': 'application/json',
}

type Callback = { url: string; method: string }

const res = await fetch(`${BASE}/${configId}`, { headers })
if (!res.ok) throw new Error(`fetching configuration failed: HTTP ${res.status} ${await res.text()}`)
const config = (await res.json()) as Record<string, unknown> & { statusCallbacks?: Callback[] | null }

const before: Callback[] = config.statusCallbacks ?? []
const kept = replace ? before.filter((cb) => !cb.url.endsWith(PATH) || cb.url === url) : before
const after: Callback[] = kept.some((cb) => cb.url === url) ? kept : [...kept, { url, method: 'POST' }]

console.log(`configuration ${configId} (${config.displayName ?? 'unnamed'})`)
console.log('statusCallbacks before:', before)
console.log('statusCallbacks after: ', after)

if (JSON.stringify(before) === JSON.stringify(after)) {
  console.log('no change needed')
} else if (!apply) {
  console.log('dry run — re-run with --apply to send this change')
} else {
  // Send back everything we fetched, changing only statusCallbacks. Server-managed
  // fields are dropped from the body.
  const { id, createdAt, updatedAt, version, ...body } = config
  const put = await fetch(`${BASE}/${configId}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ ...body, statusCallbacks: after }),
  })
  console.log(`PUT → HTTP ${put.status}`)
  if (!put.ok) {
    console.error(await put.text())
    process.exit(1)
  }
  // Updates are applied asynchronously (202): wait for the new version to show up.
  const want = JSON.stringify(after.map((cb) => cb.url).sort())
  for (let attempt = 0; attempt < 12; attempt++) {
    await new Promise((r) => setTimeout(r, 2500))
    const check = (await (await fetch(`${BASE}/${configId}`, { headers })).json()) as typeof config
    const now = (check.statusCallbacks ?? []).map((cb) => cb.url).sort()
    if (JSON.stringify(now) === want) {
      console.log(`applied (version ${check.version}):`, check.statusCallbacks)
      process.exit(0)
    }
  }
  console.error('accepted, but not visible after 30 s — check the configuration in the Console')
  process.exit(1)
}
