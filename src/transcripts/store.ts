/**
 * Per-call transcripts — who said what on each call, built from Conversation
 * Orchestrator webhooks and kept in the app's SQLite file (EVENTS_DB_PATH).
 *
 * A call is keyed by the caller's Call SID. Each Orchestrator conversation on that call
 * maps to it — the caller's own conversation, plus the office leg's after a warm
 * transfer (`linkCalls`), so the human portion lands in the same transcript.
 *
 * Persisted so dev restarts (`tsx watch`) don't empty the wallboard — Orchestrator
 * doesn't redeliver past webhooks. Orchestrator stays the system of record; this is a
 * local cache. Transcripts can hold PHI: rows older than TRANSCRIPT_RETENTION_DAYS
 * (default 7) are deleted at startup.
 *
 * Every change is published to `subscribe` listeners (the SSE stream).
 */

import Database from 'better-sqlite3'

export type Speaker = 'customer' | 'ai' | 'human' | 'unknown'

export interface Line {
  id: string
  callSid: string
  conversationId: string
  at: string
  speaker: Speaker
  text: string
}

export interface CallSummary {
  callSid: string
  from: string | null
  startedAt: string
  endedAt: string | null
  transferredAt: string | null
}

export interface CallTranscript extends CallSummary {
  lines: Line[]
}

export type TranscriptEvent = { type: 'call'; call: CallSummary } | { type: 'line'; line: Line }

const RETENTION_DAYS = Number(process.env.TRANSCRIPT_RETENTION_DAYS || 7)
const RECENT_CALLS = 50

const db = new Database(process.env.EVENTS_DB_PATH ?? 'events.db')
db.pragma('journal_mode = WAL')
db.exec(`
CREATE TABLE IF NOT EXISTS transcript_calls (
  call_sid TEXT PRIMARY KEY,
  from_address TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  transferred_at TEXT
);
CREATE TABLE IF NOT EXISTS transcript_conversations (
  conversation_id TEXT PRIMARY KEY,
  call_sid TEXT NOT NULL,
  -- 'caller' for the caller's own conversation, 'office' for a warm-transfer leg.
  leg TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS transcript_participants (
  participant_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  type TEXT,
  address TEXT
);
CREATE TABLE IF NOT EXISTS transcript_lines (
  id TEXT PRIMARY KEY,
  call_sid TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  at TEXT NOT NULL,
  speaker TEXT NOT NULL,
  text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS transcript_lines_call ON transcript_lines (call_sid, at);
`)

// Office legs are linked before Orchestrator reports their conversation: office Call
// SID → caller Call SID.
const pendingOfficeLegs = new Map<string, string>()

/** Delete transcripts older than the retention window. */
export function pruneTranscripts(): void {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString()
  const old = db.prepare('SELECT call_sid FROM transcript_calls WHERE started_at < ?').all(cutoff) as { call_sid: string }[]
  const drop = db.transaction((sids: string[]) => {
    for (const sid of sids) {
      const convs = db.prepare('SELECT conversation_id FROM transcript_conversations WHERE call_sid = ?').all(sid) as {
        conversation_id: string
      }[]
      for (const { conversation_id } of convs) {
        db.prepare('DELETE FROM transcript_participants WHERE conversation_id = ?').run(conversation_id)
      }
      db.prepare('DELETE FROM transcript_conversations WHERE call_sid = ?').run(sid)
      db.prepare('DELETE FROM transcript_lines WHERE call_sid = ?').run(sid)
      db.prepare('DELETE FROM transcript_calls WHERE call_sid = ?').run(sid)
    }
  })
  drop(old.map((r) => r.call_sid))
}
pruneTranscripts()

// --- pub/sub -----------------------------------------------------------------------

type Listener = (event: TranscriptEvent) => void
const listeners = new Set<Listener>()

export function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function publish(event: TranscriptEvent): void {
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (err) {
      console.error('transcripts: listener failed', err)
    }
  }
}

// --- reads -------------------------------------------------------------------------

function toSummary(row: Record<string, string | null>): CallSummary {
  return {
    callSid: row.call_sid!,
    from: row.from_address,
    startedAt: row.started_at!,
    endedAt: row.ended_at,
    transferredAt: row.transferred_at,
  }
}

function getSummary(callSid: string): CallSummary | undefined {
  const row = db.prepare('SELECT * FROM transcript_calls WHERE call_sid = ?').get(callSid) as
    | Record<string, string | null>
    | undefined
  return row && toSummary(row)
}

/** The most recent calls with their full transcripts, newest first. */
export function recentCalls(limit = RECENT_CALLS): CallTranscript[] {
  const rows = db
    .prepare('SELECT * FROM transcript_calls ORDER BY started_at DESC LIMIT ?')
    .all(limit) as Record<string, string | null>[]
  const lines = db.prepare(
    'SELECT id, call_sid AS callSid, conversation_id AS conversationId, at, speaker, text FROM transcript_lines WHERE call_sid = ? ORDER BY at',
  )
  return rows.map((row) => ({ ...toSummary(row), lines: lines.all(row.call_sid) as Line[] }))
}

/** The call a conversation belongs to, if we're tracking it. */
export function callForConversation(conversationId: string): { callSid: string; leg: 'caller' | 'office' } | undefined {
  const row = db
    .prepare('SELECT call_sid, leg FROM transcript_conversations WHERE conversation_id = ?')
    .get(conversationId) as { call_sid: string; leg: 'caller' | 'office' } | undefined
  return row && { callSid: row.call_sid, leg: row.leg }
}

// --- writes ------------------------------------------------------------------------

/**
 * Attach an Orchestrator conversation to a call. `channelCallSid` is the Call SID the
 * conversation's voice traffic is on: the caller's own call, or a linked office leg.
 */
export function trackConversation(conversationId: string, channelCallSid: string, at: string): void {
  if (callForConversation(conversationId)) return
  const callerSid = pendingOfficeLegs.get(channelCallSid)
  const callSid = callerSid ?? channelCallSid
  const leg = callerSid ? 'office' : 'caller'
  db.prepare('INSERT OR IGNORE INTO transcript_conversations (conversation_id, call_sid, leg) VALUES (?, ?, ?)').run(
    conversationId,
    callSid,
    leg,
  )
  db.prepare('INSERT OR IGNORE INTO transcript_calls (call_sid, started_at) VALUES (?, ?)').run(callSid, at)

  // The caller's number may have arrived (on a participant) before we knew the call.
  if (leg === 'caller') {
    const customer = db
      .prepare("SELECT address FROM transcript_participants WHERE conversation_id = ? AND type = 'CUSTOMER' AND address IS NOT NULL")
      .get(conversationId) as { address: string } | undefined
    if (customer) {
      db.prepare('UPDATE transcript_calls SET from_address = ? WHERE call_sid = ? AND from_address IS NULL').run(customer.address, callSid)
    }
  }
  publish({ type: 'call', call: getSummary(callSid)! })
}

/** Record a participant's type and address (used to label lines). */
export function upsertParticipant(participantId: string, conversationId: string, type: string | null, address: string | null): void {
  db.prepare(
    `INSERT INTO transcript_participants (participant_id, conversation_id, type, address) VALUES (?, ?, ?, ?)
     ON CONFLICT(participant_id) DO UPDATE SET type = COALESCE(excluded.type, type), address = COALESCE(excluded.address, address)`,
  ).run(participantId, conversationId, type, address)

  // The caller's number becomes the call's "from".
  const call = callForConversation(conversationId)
  if (call?.leg === 'caller' && type === 'CUSTOMER' && address) {
    const changed = db
      .prepare('UPDATE transcript_calls SET from_address = ? WHERE call_sid = ? AND from_address IS NULL')
      .run(address, call.callSid).changes
    if (changed) publish({ type: 'call', call: getSummary(call.callSid)! })
  }
}

/** Who a participant is on this call, from its Orchestrator type, or its address as a fallback. */
export function speakerFor(participantId: string | undefined, authorAddress: string | undefined, conversationId: string): Speaker {
  const leg = callForConversation(conversationId)?.leg ?? 'caller'
  const p = participantId
    ? (db.prepare('SELECT type, address FROM transcript_participants WHERE participant_id = ?').get(participantId) as
        | { type: string | null; address: string | null }
        | undefined)
    : undefined
  switch (p?.type) {
    case 'CUSTOMER':
      return 'customer'
    case 'AI_AGENT':
      return 'ai'
    case 'HUMAN_AGENT':
      return 'human'
    case 'AGENT':
      // Our number's side of the call: the AI on the caller's leg, the office person on
      // a warm-transfer leg.
      return leg === 'office' ? 'human' : 'ai'
  }
  const address = p?.address ?? authorAddress
  if (!address) return 'unknown'
  if (address === process.env.TWILIO_PHONE_NUMBER) return leg === 'office' ? 'human' : 'ai'
  // On the office leg, the other party is the office phone itself.
  if (leg === 'office') return address === process.env.OFFICE_PHONE_NUMBER ? 'human' : 'unknown'
  return 'customer'
}

/** Add one utterance. Ignores duplicates (webhook retries). */
export function addLine(line: Line): void {
  const inserted = db
    .prepare(
      'INSERT OR IGNORE INTO transcript_lines (id, call_sid, conversation_id, at, speaker, text) VALUES (@id, @callSid, @conversationId, @at, @speaker, @text)',
    )
    .run(line).changes
  if (inserted) publish({ type: 'line', line })
}

/** Mark the call ended (its caller-leg conversation closed). */
export function endCall(callSid: string, at: string): void {
  const changed = db
    .prepare('UPDATE transcript_calls SET ended_at = ? WHERE call_sid = ? AND ended_at IS NULL')
    .run(at, callSid).changes
  if (changed) publish({ type: 'call', call: getSummary(callSid)! })
}

/** Warm transfer started: the office leg's conversation belongs to the caller's transcript. */
export function linkCalls(callerSid: string, officeSid: string): void {
  pendingOfficeLegs.set(officeSid, callerSid)
  // Forget the link once its conversation could no longer appear.
  setTimeout(() => pendingOfficeLegs.delete(officeSid), 30 * 60_000).unref()
}

/** The office accepted the transfer — the human portion of the call starts here. */
export function markTransferred(callerSid: string, at = new Date().toISOString()): void {
  const changed = db
    .prepare('UPDATE transcript_calls SET transferred_at = ? WHERE call_sid = ? AND transferred_at IS NULL')
    .run(at, callerSid).changes
  if (changed) publish({ type: 'call', call: getSummary(callerSid)! })
}
