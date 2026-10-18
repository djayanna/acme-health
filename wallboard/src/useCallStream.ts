import { useEffect, useState } from 'react'

// Mirrors the backend's transcript store (src/transcripts/store.ts) and events table
// (src/observability.ts). See docs/schema.md.
export type Speaker = 'customer' | 'ai' | 'human' | 'unknown'

export type Line = {
  id: string
  callSid: string
  conversationId: string
  at: string
  speaker: Speaker
  text: string
}

export type CallEvent = {
  id: number
  ts: string
  component: string
  method: string
  event_type: string
  correlation_id: string | null
  status: string
  payload_json: string | null
}

export type Call = {
  callSid: string
  officeCallSid: string | null
  from: string | null
  startedAt: string
  endedAt: string | null
  transferredAt: string | null
  lines: Line[]
  events: CallEvent[]
}

export type StreamState = 'connecting' | 'live' | 'reconnecting'

const byTime = <T,>(at: (x: T) => string) => (a: T, b: T) => at(a).localeCompare(at(b))

/**
 * Live calls from GET /calls/stream (Server-Sent Events). The backend sends a snapshot
 * on connect, then one `call`, `line` or `event` message per change — no polling.
 * EventSource reconnects on its own; each reconnect starts with a fresh snapshot.
 *
 * Also returns every event seen live (for the full log), newest first.
 */
export function useCallStream(): { calls: Call[]; liveEvents: CallEvent[]; state: StreamState } {
  const [calls, setCalls] = useState<Call[]>([])
  const [liveEvents, setLiveEvents] = useState<CallEvent[]>([])
  const [state, setState] = useState<StreamState>('connecting')

  useEffect(() => {
    const source = new EventSource('/api/calls/stream')
    const data = <T,>(e: Event) => JSON.parse((e as MessageEvent).data) as T

    source.onopen = () => setState('live')
    source.onerror = () => setState('reconnecting')

    source.addEventListener('snapshot', (e) => setCalls(data<Call[]>(e)))

    source.addEventListener('call', (e) => {
      const summary = data<Omit<Call, 'lines' | 'events'>>(e)
      setCalls((prev) =>
        prev.some((c) => c.callSid === summary.callSid)
          ? prev.map((c) => (c.callSid === summary.callSid ? { ...c, ...summary } : c))
          : [{ ...summary, lines: [], events: [] }, ...prev],
      )
    })

    source.addEventListener('line', (e) => {
      const line = data<Line>(e)
      setCalls((prev) =>
        prev.map((c) =>
          c.callSid !== line.callSid || c.lines.some((l) => l.id === line.id)
            ? c
            : { ...c, lines: [...c.lines, line].sort(byTime((l) => l.at)) },
        ),
      )
    })

    source.addEventListener('event', (e) => {
      const { callSid, ...event } = data<CallEvent & { callSid: string | null }>(e)
      setLiveEvents((prev) => [event, ...prev].slice(0, 500))
      if (!callSid) return
      setCalls((prev) => {
        const known = prev.some((c) => c.callSid === callSid)
        // The agent's first events can arrive before the call's first transcript line.
        const next = known
          ? prev
          : [
              {
                callSid,
                officeCallSid: null,
                from: null,
                startedAt: event.ts,
                endedAt: null,
                transferredAt: null,
                lines: [],
                events: [],
              },
              ...prev,
            ]
        return next.map((c) =>
          c.callSid !== callSid || c.events.some((x) => x.id === event.id)
            ? c
            : { ...c, events: [...c.events, event].sort(byTime((x) => x.ts)) },
        )
      })
    })

    return () => source.close()
  }, [])

  return { calls, liveEvents, state }
}

/** An event's payload as an object, or null. */
export function payloadOf(event: CallEvent): Record<string, unknown> | null {
  if (!event.payload_json) return null
  try {
    const value = JSON.parse(event.payload_json)
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : { value }
  } catch {
    return { raw: event.payload_json }
  }
}
