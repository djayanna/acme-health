/**
 * Re-file stored transcript lines under the call they were actually said on.
 *
 * Before the fix in src/transcripts/store.ts, every line in an Orchestrator conversation
 * was filed under the conversation's first call — but a conversation can span several
 * calls (a repeat call within the voice timeout reuses it). This reads each tracked
 * conversation's communications back from Conversation Orchestrator (each carries its
 * Call SID in `channelId`) and moves the local lines to the right call, creating call
 * rows that are missing.
 *
 *   npm run repair-transcripts            # show what would change
 *   npm run repair-transcripts -- --apply # change events.db (back it up first)
 *
 * Only touches the local SQLite file (EVENTS_DB_PATH); nothing is changed in Twilio.
 */

import 'dotenv/config'
import Database from 'better-sqlite3'

const apply = process.argv.includes('--apply')
const db = new Database(process.env.EVENTS_DB_PATH ?? 'events.db')

const [user, pass] =
  process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET
    ? [process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET]
    : [process.env.TWILIO_ACCOUNT_SID!, process.env.TWILIO_AUTH_TOKEN!]
const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`

type Comm = { id: string; channelId?: string; occurredAt?: string; createdAt?: string }

/** Every communication in a conversation, following pagination. */
async function communications(conversationId: string): Promise<Comm[]> {
  const out: Comm[] = []
  let token: string | undefined
  do {
    const url = new URL(`https://conversations.twilio.com/v2/Conversations/${conversationId}/Communications`)
    url.searchParams.set('pageSize', '100')
    if (token) url.searchParams.set('pageToken', token)
    const res = await fetch(url, { headers: { Authorization: auth } })
    if (!res.ok) throw new Error(`${conversationId}: HTTP ${res.status} ${await res.text()}`)
    const page = (await res.json()) as { communications?: Comm[]; meta?: { nextToken?: string } }
    out.push(...(page.communications ?? []))
    token = page.meta?.nextToken
  } while (token)
  return out
}

const conversations = db.prepare('SELECT DISTINCT conversation_id FROM transcript_lines').all() as { conversation_id: string }[]
const line = db.prepare('SELECT call_sid FROM transcript_lines WHERE id = ?')
const officeOf = db.prepare('SELECT call_sid FROM transcript_calls WHERE office_call_sid = ?')

const moves: Array<{ id: string; from: string; to: string; at: string }> = []
for (const { conversation_id } of conversations) {
  for (const c of await communications(conversation_id)) {
    const row = line.get(c.id) as { call_sid: string } | undefined
    if (!row || !c.channelId?.startsWith('CA')) continue
    // An office leg's lines belong to its caller; everything else to its own call.
    const target = (officeOf.get(c.channelId) as { call_sid: string } | undefined)?.call_sid ?? c.channelId
    if (row.call_sid !== target) moves.push({ id: c.id, from: row.call_sid, to: target, at: c.occurredAt ?? c.createdAt ?? '' })
  }
}

const byTarget = new Map<string, typeof moves>()
for (const m of moves) byTarget.set(m.to, [...(byTarget.get(m.to) ?? []), m])
console.log(`${conversations.length} conversation(s) checked; ${moves.length} line(s) on the wrong call`)
for (const [to, ms] of byTarget) console.log(`  → ${to}: ${ms.length} line(s) (from ${[...new Set(ms.map((m) => m.from))].join(', ')})`)

if (!moves.length || !apply) {
  if (moves.length) console.log('\ndry run — re-run with --apply to fix events.db')
  process.exit(0)
}

db.transaction(() => {
  for (const [to, ms] of byTarget) {
    const first = ms.map((m) => m.at).filter(Boolean).sort()[0]
    const source = db.prepare('SELECT from_address FROM transcript_calls WHERE call_sid = ?').get(ms[0].from) as
      | { from_address: string | null }
      | undefined
    // Create the call if it's missing; same caller as the call its lines were filed under.
    db.prepare('INSERT OR IGNORE INTO transcript_calls (call_sid, from_address, started_at) VALUES (?, ?, ?)').run(
      to,
      source?.from_address ?? null,
      first,
    )
    for (const m of ms) db.prepare('UPDATE transcript_lines SET call_sid = ? WHERE id = ?').run(to, m.id)
  }
  // Each call's start is its first line.
  db.exec(`UPDATE transcript_calls SET started_at = COALESCE(
    (SELECT MIN(at) FROM transcript_lines WHERE transcript_lines.call_sid = transcript_calls.call_sid), started_at)`)
})()
console.log(`moved ${moves.length} line(s); restart the app (or reload the wallboard) to see the result`)
