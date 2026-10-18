import { useEffect, useMemo, useRef, useState } from 'react'

import { formatDuration, keyLabel, kindOf, labelOf, summaryOf } from './events'
import { payloadOf, type Call, type CallEvent, type Line, type Speaker } from './useCallStream'

const SPEAKER_LABEL: Record<Speaker, string> = {
  customer: 'Caller',
  ai: 'AI agent',
  human: 'Office',
  unknown: 'Unknown',
}

/** 24-hour HH:MM:SS — fixed width, so the time column stays aligned. */
export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })

const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** What happened on a call, in a word — the outcome a front desk cares about. */
function outcomeOf(call: Call): { label: string; tone: 'live' | 'office' | 'done' | 'error' } {
  if (!call.endedAt && !call.events.some((e) => e.method === 'callEnded')) return { label: 'Live', tone: 'live' }
  if (call.transferredAt) return { label: 'Sent to office', tone: 'office' }
  if (call.events.some((e) => e.method === 'recoverCaller')) return { label: 'Office unavailable', tone: 'error' }
  const booked = call.events.some((e) => e.method === 'toolCall' && /book|reschedul|cancel/.test(String(payloadOf(e)?.tool)))
  return { label: booked ? 'Appointment handled' : 'AI handled', tone: 'done' }
}

export function CallList({
  calls,
  selected,
  onSelect,
}: {
  calls: Call[]
  selected?: string
  onSelect: (callSid: string) => void
}) {
  if (!calls.length) {
    return (
      <div className="empty">
        <p>No calls yet.</p>
        <p className="dim">Call the clinic number and it shows up here as it happens.</p>
      </div>
    )
  }
  return (
    <ul className="call-list" role="listbox" aria-label="Calls">
      {calls.map((call) => {
        const outcome = outcomeOf(call)
        return (
          <li key={call.callSid}>
            <button
              role="option"
              aria-selected={call.callSid === selected}
              className={`call-row${call.callSid === selected ? ' is-selected' : ''}`}
              onClick={() => onSelect(call.callSid)}
            >
              <span className="call-row-top">
                <span className="call-from">{call.from ?? 'Unknown caller'}</span>
                <span className={`pill tone-${outcome.tone}`}>{outcome.label}</span>
              </span>
              <span className="call-row-bottom mono">
                {ago(call.startedAt)} · {call.lines.length} lines
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** The header strip: who called, how it went, and the call's vital signs. */
function CallHeader({ call }: { call: Call }) {
  const outcome = outcomeOf(call)
  const ended = call.events.find((e) => e.method === 'callEnded')
  const end = ended ? payloadOf(ended) : null
  const started = call.events.find((e) => e.method === 'callStarted')
  const start = started ? payloadOf(started) : null
  const tools = call.events.filter((e) => e.method === 'toolCall').length
  const turns = call.events.filter((e) => e.method === 'turn')
  const avgTurn = turns.length
    ? turns.reduce((sum, e) => sum + Number(payloadOf(e)?.durationMs ?? 0), 0) / turns.length / 1000
    : null

  // The whole call — AI and office portions — from first to last activity. (callEnded's
  // durationSec covers only the AI session, which ends at a handoff.)
  const times = [call.startedAt, ...call.lines.map((l) => l.at), ...call.events.map((e) => e.ts)].map((t) => Date.parse(t))
  const spanSec = (Math.max(...times) - Math.min(...times)) / 1000
  const isLive = outcome.tone === 'live'
  const agentTurns = typeof end?.turns === 'number' ? end.turns : turns.length

  const vitals: Array<[string, string]> = [
    ['Duration', isLive ? `${formatDuration(spanSec)} so far` : formatDuration(spanSec)],
    ['Agent turns', String(agentTurns)],
    ['Avg reply', avgTurn === null ? '—' : `${avgTurn.toFixed(1)} s`],
    ['Tool calls', String(tools)],
    ['Verified', end?.verified === true || call.events.some((e) => payloadOf(e)?.tool === 'verify_caller' && (payloadOf(e)?.outcome as Record<string, unknown>)?.verified) ? 'yes' : 'no'],
    ['Mode', String(start?.mode ?? '—')],
  ]

  return (
    <header className="chart-head">
      <div className="chart-id">
        <h2>{call.from ?? 'Unknown caller'}</h2>
        <span className={`pill tone-${outcome.tone}`}>{outcome.label}</span>
      </div>
      <p className="chart-meta mono">
        {clock(call.startedAt)}
        {call.endedAt ? ` – ${clock(call.endedAt)}` : ''} · {call.callSid}
        {call.officeCallSid ? ` · office leg ${call.officeCallSid}` : ''}
      </p>
      <dl className="vitals">
        {vitals.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className="mono">{v}</dd>
          </div>
        ))}
      </dl>
    </header>
  )
}

/** An event on the timeline, expandable to show its payload. */
function EventEntry({ event }: { event: CallEvent }) {
  const [open, setOpen] = useState(false)
  const payload = payloadOf(event)
  const kind = kindOf(event)
  const summary = summaryOf(event)
  return (
    <div className={`event kind-${kind}${open ? ' is-open' : ''}`}>
      <button
        className="event-head"
        onClick={() => payload && setOpen(!open)}
        aria-expanded={payload ? open : undefined}
        disabled={!payload}
      >
        <span className="event-label">{labelOf(event)}</span>
        {summary && <span className="event-summary">{summary}</span>}
        {payload && <span className="chevron" aria-hidden="true" />}
      </button>
      {open && payload && <Payload value={payload} />}
    </div>
  )
}

/** A payload as key/value rows; nested objects become indented groups. */
function Payload({ value }: { value: Record<string, unknown> }) {
  return (
    <dl className="payload mono">
      {Object.entries(value).map(([key, v]) => (
        <div key={key} className={v && typeof v === 'object' ? 'is-group' : undefined}>
          <dt>{keyLabel(key)}</dt>
          <dd>
            {v && typeof v === 'object' ? (
              <Payload value={v as Record<string, unknown>} />
            ) : v === null ? (
              <span className="dim">none</span>
            ) : (
              String(v)
            )}
          </dd>
        </div>
      ))}
    </dl>
  )
}

type Row =
  | { kind: 'line'; at: string; line: Line }
  | { kind: 'event'; at: string; event: CallEvent }
  | { kind: 'transfer'; at: string }

/**
 * The call on one time axis: what was said on the left, what the system did on the
 * right, with a rule where the office took over.
 */
function Timeline({ call, showEvents }: { call: Call; showEvents: boolean }) {
  const end = useRef<HTMLDivElement>(null)

  const rows = useMemo(() => {
    const out: Row[] = [
      ...call.lines.map((line): Row => ({ kind: 'line', at: line.at, line })),
      ...(showEvents
        ? call.events
            // Turn timings live in the header's vitals; keep the rail to meaningful moments.
            .filter((e) => !(e.method === 'turn' && e.event_type !== 'interrupted'))
            .map((event): Row => ({ kind: 'event', at: event.ts, event }))
        : []),
      ...(call.transferredAt ? [{ kind: 'transfer', at: call.transferredAt } as Row] : []),
    ]
    return out.sort((a, b) => a.at.localeCompare(b.at))
  }, [call, showEvents])

  // Follow a live call as it goes.
  useEffect(() => {
    if (!call.endedAt) end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [rows.length, call.endedAt])

  if (!rows.length) return <p className="dim pad">Waiting for the first words…</p>

  return (
    <ol className="timeline">
      {rows.map((row) => {
        if (row.kind === 'transfer') {
          return (
            <li key={`transfer-${row.at}`} className="tl-transfer">
              <span>Office took the call · {clock(row.at)}</span>
            </li>
          )
        }
        if (row.kind === 'event') {
          return (
            <li key={`e-${row.event.id}`} className="tl-row tl-event">
              <time className="tl-time mono">{clock(row.at)}</time>
              <span className="tl-node" aria-hidden="true" />
              <div className="tl-side">
                <EventEntry event={row.event} />
              </div>
            </li>
          )
        }
        const { line } = row
        return (
          <li key={line.id} className={`tl-row tl-line speaker-${line.speaker}`}>
            <time className="tl-time mono">{clock(line.at)}</time>
            <span className="tl-node" aria-hidden="true" />
            <div className="tl-main">
              <span className="who">{SPEAKER_LABEL[line.speaker]}</span>
              <p>{line.text}</p>
            </div>
          </li>
        )
      })}
      <div ref={end} />
    </ol>
  )
}

export function CallView({ call }: { call: Call | undefined }) {
  const [showEvents, setShowEvents] = useState(true)
  if (!call) {
    return (
      <div className="empty pad">
        <p>Pick a call to see what was said and what the system did.</p>
      </div>
    )
  }
  return (
    <article className="chart" aria-label={`Call from ${call.from ?? 'unknown caller'}`}>
      <CallHeader call={call} />
      <div className="chart-tools">
        <span className="legend">
          <span className="swatch speaker-customer" /> Caller
          <span className="swatch speaker-ai" /> AI agent
          <span className="swatch speaker-human" /> Office
        </span>
        <label className="toggle">
          <input type="checkbox" checked={showEvents} onChange={(e) => setShowEvents(e.target.checked)} />
          Show system events
        </label>
      </div>
      <Timeline call={call} showEvents={showEvents} />
    </article>
  )
}
