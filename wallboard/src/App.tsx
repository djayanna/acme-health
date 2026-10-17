import { useEffect, useMemo, useState } from 'react'

// One row of the backend's events table (CLAUDE.md §6).
type EventRow = {
  id: number
  ts: string
  component: string
  method: string
  event_type: string
  correlation_id: string | null
  status: string
  payload_json: string | null
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="tile">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
    </div>
  )
}

export function App() {
  const [rows, setRows] = useState<EventRow[]>([])
  const [updatedAt, setUpdatedAt] = useState<string>('')
  const [error, setError] = useState<string>('')

  // Deliberately simple: a Refresh button pings GET /events. No polling, no WS.
  async function refresh() {
    try {
      const res = await fetch('/api/events?limit=100')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setRows((await res.json()) as EventRow[])
      setUpdatedAt(new Date().toLocaleTimeString())
      setError('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load events')
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const stats = useMemo(() => {
    const errors = rows.filter((r) => r.status === 'error').length
    const correlations = new Set(rows.map((r) => r.correlation_id).filter(Boolean)).size
    return { total: rows.length, errors, correlations }
  }, [rows])

  return (
    <div className="wb">
      <header className="wb-head">
        <h1>acme-health · wallboard</h1>
        <div className="wb-actions">
          {updatedAt && <span className="dim">updated {updatedAt}</span>}
          <button onClick={refresh}>Refresh</button>
        </div>
      </header>

      {error && <p className="err">Could not reach the backend: {error}</p>}

      <div className="tiles">
        <Tile label="events" value={stats.total} />
        <Tile label="errors" value={stats.errors} />
        <Tile label="interactions" value={stats.correlations} />
      </div>

      <div className="panel">
        <h2>recent events</h2>
        <table className="events">
          <thead>
            <tr>
              <th>time</th>
              <th>component</th>
              <th>method</th>
              <th>event</th>
              <th>status</th>
              <th>correlation</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className={`row row-${r.status}`}>
                <td className="dim">{r.ts.slice(11, 19)}</td>
                <td>{r.component}</td>
                <td>{r.method}</td>
                <td>{r.event_type}</td>
                <td className={`status ${r.status}`}>{r.status}</td>
                <td>
                  <code className="corr">{r.correlation_id ?? '—'}</code>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="dim">
                  no events yet — trigger an interaction, then click Refresh
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
