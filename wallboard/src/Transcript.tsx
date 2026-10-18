import { useEffect, useRef } from 'react'

import type { Call, Line, Speaker } from './useCallStream'

const SPEAKER_LABEL: Record<Speaker, string> = {
  customer: 'Customer',
  ai: 'AI agent',
  human: 'Office',
  unknown: 'Unknown',
}

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** One call row in the list: number, start time, and whether it's still live. */
export function CallRow({ call, selected, onSelect }: { call: Call; selected: boolean; onSelect: () => void }) {
  const live = !call.endedAt
  return (
    <button className={`call-row${selected ? ' selected' : ''}`} onClick={onSelect}>
      <span className={`dot ${live ? 'live' : 'ended'}`} aria-label={live ? 'live' : 'ended'} />
      <span className="call-from">{call.from ?? 'Unknown caller'}</span>
      <span className="dim">{time(call.startedAt)}</span>
      {call.transferredAt && <span className="badge">transferred</span>}
      <span className="dim count">{call.lines.length}</span>
    </button>
  )
}

/** The selected call's transcript, oldest first, with a divider where the office took over. */
export function Transcript({ call }: { call: Call | undefined }) {
  const end = useRef<HTMLDivElement>(null)
  const count = call?.lines.length ?? 0

  // Keep the newest line in view as the call goes on.
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [call?.callSid, count])

  if (!call) return <p className="dim">Select a call to see its transcript.</p>

  const items: Array<{ kind: 'line'; line: Line } | { kind: 'divider'; at: string }> = []
  let dividerShown = false
  for (const line of call.lines) {
    if (!dividerShown && call.transferredAt && line.at >= call.transferredAt) {
      items.push({ kind: 'divider', at: call.transferredAt })
      dividerShown = true
    }
    items.push({ kind: 'line', line })
  }
  if (!dividerShown && call.transferredAt) items.push({ kind: 'divider', at: call.transferredAt })

  return (
    <div className="transcript">
      <div className="transcript-head">
        <strong>{call.from ?? 'Unknown caller'}</strong>
        <span className="dim">
          {time(call.startedAt)}
          {call.endedAt ? ` – ${time(call.endedAt)}` : ' · live'}
        </span>
        <code className="corr">{call.callSid}</code>
      </div>

      {!call.lines.length && <p className="dim">Waiting for the first words…</p>}

      {items.map((item) =>
        item.kind === 'divider' ? (
          <div key={`divider-${item.at}`} className="divider">
            Transferred to office · {time(item.at)}
          </div>
        ) : (
          <div key={item.line.id} className={`bubble ${item.line.speaker}`}>
            <div className="who">
              {SPEAKER_LABEL[item.line.speaker]} <span className="dim">{time(item.line.at)}</span>
            </div>
            <div>{item.line.text}</div>
          </div>
        ),
      )}
      <div ref={end} />
    </div>
  )
}
