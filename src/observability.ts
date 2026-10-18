/**
 * Event store + emission — acme-health.
 *
 * Every generated app records what its Twilio integrations do, so a workshop
 * audience can watch the system work (the standalone wallboard reads these
 * events over `GET /events`). Observability is always on; *where* events are
 * stored is a runtime choice, `EVENTS_BACKEND` (default `sqlite`).
 *
 * The event row shape is fixed (CLAUDE.md §6):
 *   id, ts, component, method, event_type (start|success|error),
 *   correlation_id, status, payload_json
 *
 * Components call `emitEvent(...)` at each instrumented call site, passing the
 * correlation id (call/session/conversation SID) that ties one interaction's
 * events together. Emission never throws into the Twilio path — a telemetry
 * failure is logged and swallowed.
 *
 * Adding a backend (MySQL, an HTTP sink, …) is a new `Store` implementation
 * plus one entry in `buildStore` — no change to any component.
 */

import Database from 'better-sqlite3'
import type { FastifyInstance } from 'fastify'

export const EVENT_TYPES = ['start', 'success', 'error'] as const
export type EventType = (typeof EVENT_TYPES)[number]

export interface EventRow {
  ts: string
  component: string
  method: string
  event_type: string
  correlation_id: string | null
  status: string
  payload_json: string | null
}

/** The surface every events backend implements. */
export interface Store {
  init(): void
  /** Store one event; returns its id. */
  record(event: EventRow): number
  recent(limit: number): Record<string, unknown>[]
  /** Events whose correlation id is one of `ids`, oldest first. */
  forCorrelation(ids: string[], limit: number): Record<string, unknown>[]
}

const CREATE_EVENTS = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts TEXT NOT NULL,
  component TEXT,
  method TEXT,
  event_type TEXT,
  correlation_id TEXT,
  status TEXT,
  payload_json TEXT
)`

/** Default store: a single SQLite file (`EVENTS_DB_PATH`, default events.db). */
class SqliteStore implements Store {
  private db: Database.Database

  constructor(path: string) {
    this.db = new Database(path)
  }

  init(): void {
    this.db.exec(CREATE_EVENTS)
  }

  record(event: EventRow): number {
    return Number(
      this.db
        .prepare(
          'INSERT INTO events (ts, component, method, event_type, correlation_id, status, payload_json) ' +
            'VALUES (@ts, @component, @method, @event_type, @correlation_id, @status, @payload_json)',
        )
        .run(event).lastInsertRowid,
    )
  }

  recent(limit: number): Record<string, unknown>[] {
    return this.db
      .prepare(
        'SELECT id, ts, component, method, event_type, correlation_id, status, payload_json ' +
          'FROM events ORDER BY id DESC LIMIT ?',
      )
      .all(limit) as Record<string, unknown>[]
  }

  forCorrelation(ids: string[], limit: number): Record<string, unknown>[] {
    if (!ids.length) return []
    return this.db
      .prepare(
        'SELECT id, ts, component, method, event_type, correlation_id, status, payload_json ' +
          `FROM events WHERE correlation_id IN (${ids.map(() => '?').join(',')}) ORDER BY id LIMIT ?`,
      )
      .all(...ids, limit) as Record<string, unknown>[]
  }
}

function buildStore(): Store {
  const backend = (process.env.EVENTS_BACKEND ?? 'sqlite').trim().toLowerCase()
  if (backend === 'sqlite') {
    return new SqliteStore(process.env.EVENTS_DB_PATH ?? 'events.db')
  }
  const supported = 'sqlite'
  throw new Error(`unsupported events backend '${backend}'; supported backends: ${supported}`)
}

const store: Store = buildStore()

/** Create the events table (called once at app startup). */
export function initStore(): void {
  store.init()
}

export interface EmitOptions {
  correlationId?: string | null
  status?: string
  payload?: unknown
}

/** A stored event, as `GET /events` returns it and live listeners receive it. */
export type StoredEvent = EventRow & { id: number }

type EventListener = (event: StoredEvent) => void
const eventListeners = new Set<EventListener>()

/** Get every event as it's recorded (the wallboard's live stream). */
export function onEvent(listener: EventListener): () => void {
  eventListeners.add(listener)
  return () => eventListeners.delete(listener)
}

/** Events tied to a call — `ids` is its Call SID plus any linked leg's. */
export function eventsFor(ids: string[], limit = 500): Record<string, unknown>[] {
  return store.forCorrelation(ids, limit)
}

/** Record one event. Never throws — telemetry must not break a Twilio call. */
export function emitEvent(
  component: string,
  method: string,
  eventType: EventType | string,
  options: EmitOptions = {},
): void {
  try {
    const row: EventRow = {
      ts: new Date().toISOString(),
      component,
      method,
      event_type: eventType,
      correlation_id: options.correlationId ?? null,
      status: options.status ?? 'success',
      payload_json: options.payload !== undefined ? JSON.stringify(options.payload) : null,
    }
    const id = store.record(row)
    for (const listener of eventListeners) {
      try {
        listener({ ...row, id })
      } catch (err) {
        console.error('emitEvent: listener failed', err)
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`emitEvent failed for ${component}.${method}`, err)
  }
}

/** GET /events — the wallboard's feed. */
export async function routes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { limit?: string } }>('/events', async (req) => {
    const raw = Number(req.query.limit ?? 100)
    const limit = Math.min(Math.max(Number.isFinite(raw) ? raw : 100, 1), 1000)
    return store.recent(limit)
  })
}
