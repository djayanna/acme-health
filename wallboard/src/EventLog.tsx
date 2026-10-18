import { useEffect, useMemo, useState } from 'react'

import { clock } from './CallView'
import { keyLabel, kindOf, labelOf } from './events'
import { payloadOf, type CallEvent } from './useCallStream'

/**
 * Every event, newest first: the GET /events history, plus anything that arrives live.
 * Filter to errors, or search by component, step or Call SID.
 */
export function EventLog({ liveEvents, onOpenCall }: { liveEvents: CallEvent[]; onOpenCall: (sid: string) => void }) {
  const [history, setHistory] = useState<CallEvent[]>([])
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [openId, setOpenId] = useState<number>()

  useEffect(() => {
    fetch('/api/events?limit=500')
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((rows: CallEvent[]) => setHistory(rows))
      .catch((err: Error) => setError(err.message))
  }, [])

  const events = useMemo(() => {
    const seen = new Set<number>()
    const all = [...liveEvents, ...history].filter((e) => !seen.has(e.id) && (seen.add(e.id), true))
    const q = query.trim().toLowerCase()
    return all
      .filter((e) => !errorsOnly || kindOf(e) === 'error')
      .filter((e) => !q || [e.component, e.method, e.correlation_id, labelOf(e)].some((v) => v?.toLowerCase().includes(q)))
      // Newest first by when it happened (ids follow insert order, not event time).
      .sort((a, b) => b.ts.localeCompare(a.ts) || b.id - a.id)
  }, [liveEvents, history, query, errorsOnly])

  return (
    <section className="log" aria-label="Event log">
      <div className="log-tools">
        <input
          type="search"
          placeholder="Search by step or Call SID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search events"
        />
        <label className="toggle">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          Errors only
        </label>
        <span className="dim mono">{events.length} events</span>
      </div>
      {error && <p className="err">Couldn’t load past events ({error}). New ones still appear live.</p>}
      <table className="log-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>What happened</th>
            <th>Step</th>
            <th>Call</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => {
            const payload = payloadOf(e)
            const open = openId === e.id
            return (
              <FragmentRow key={e.id}>
                <tr className={`kind-${kindOf(e)}${open ? ' is-open' : ''}`}>
                  <td className="mono">{clock(e.ts)}</td>
                  <td>
                    <button
                      className="linklike"
                      disabled={!payload}
                      aria-expanded={payload ? open : undefined}
                      onClick={() => setOpenId(open ? undefined : e.id)}
                    >
                      {labelOf(e)}
                      {payload && <span className="chevron" aria-hidden="true" />}
                    </button>
                  </td>
                  <td className="mono dim">
                    {e.component}.{e.method}
                  </td>
                  <td className="mono">
                    {e.correlation_id?.startsWith('CA') ? (
                      <button className="linklike" onClick={() => onOpenCall(e.correlation_id!)}>
                        {e.correlation_id.slice(0, 10)}…
                      </button>
                    ) : (
                      <span className="dim">—</span>
                    )}
                  </td>
                </tr>
                {open && payload && (
                  <tr className="log-payload">
                    <td />
                    <td colSpan={3}>
                      <dl className="payload mono">
                        {Object.entries(payload).map(([k, v]) => (
                          <div key={k}>
                            <dt>{keyLabel(k)}</dt>
                            <dd>{v && typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                  </tr>
                )}
              </FragmentRow>
            )
          })}
          {!events.length && (
            <tr>
              <td colSpan={4} className="dim pad">
                {errorsOnly ? 'No errors.' : 'No events match.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  )
}

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
