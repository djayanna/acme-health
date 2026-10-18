import { useEffect, useState } from 'react'

// Mirrors the backend's transcript store (src/transcripts/store.ts).
export type Speaker = 'customer' | 'ai' | 'human' | 'unknown'

export type Line = {
  id: string
  callSid: string
  conversationId: string
  at: string
  speaker: Speaker
  text: string
}

export type Call = {
  callSid: string
  from: string | null
  startedAt: string
  endedAt: string | null
  transferredAt: string | null
  lines: Line[]
}

export type StreamState = 'connecting' | 'live' | 'reconnecting'

/**
 * Live calls from GET /calls/stream (Server-Sent Events). The backend sends a snapshot
 * on connect, then a `call` or `line` event per change — no polling. EventSource
 * reconnects on its own; each reconnect starts with a fresh snapshot.
 */
export function useCallStream(): { calls: Call[]; state: StreamState } {
  const [calls, setCalls] = useState<Call[]>([])
  const [state, setState] = useState<StreamState>('connecting')

  useEffect(() => {
    const source = new EventSource('/api/calls/stream')

    source.onopen = () => setState('live')
    source.onerror = () => setState('reconnecting')

    source.addEventListener('snapshot', (e) => {
      setCalls(JSON.parse((e as MessageEvent).data) as Call[])
    })

    source.addEventListener('call', (e) => {
      const summary = JSON.parse((e as MessageEvent).data) as Omit<Call, 'lines'>
      setCalls((prev) => {
        const existing = prev.find((c) => c.callSid === summary.callSid)
        if (existing) return prev.map((c) => (c.callSid === summary.callSid ? { ...c, ...summary } : c))
        return [{ ...summary, lines: [] }, ...prev]
      })
    })

    source.addEventListener('line', (e) => {
      const line = JSON.parse((e as MessageEvent).data) as Line
      setCalls((prev) =>
        prev.map((c) =>
          c.callSid !== line.callSid || c.lines.some((l) => l.id === line.id)
            ? c
            : { ...c, lines: [...c.lines, line].sort((a, b) => a.at.localeCompare(b.at)) },
        ),
      )
    })

    return () => source.close()
  }, [])

  return { calls, state }
}
