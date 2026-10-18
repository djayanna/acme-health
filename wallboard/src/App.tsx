import { useState } from 'react'

import { CallList, CallView } from './CallView'
import { EventLog } from './EventLog'
import { useCallStream, type StreamState } from './useCallStream'

const STREAM_LABEL: Record<StreamState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
}

type Tab = 'calls' | 'log'

export function App() {
  const { calls, liveEvents, state } = useCallStream()
  const [tab, setTab] = useState<Tab>('calls')
  const [selectedSid, setSelectedSid] = useState<string>()
  // Follow the newest call until someone picks one.
  const selected = calls.find((c) => c.callSid === selectedSid) ?? calls[0]
  const live = calls.filter((c) => !c.endedAt && !c.events.some((e) => e.method === 'callEnded')).length

  const openCall = (sid: string) => {
    setSelectedSid(sid)
    setTab('calls')
  }

  return (
    <div className="wb">
      <header className="masthead">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <h1>
            Acme Health <span className="brand-sub">front desk</span>
          </h1>
        </div>
        <nav className="tabs" aria-label="Views">
          <button aria-pressed={tab === 'calls'} onClick={() => setTab('calls')}>
            Calls
          </button>
          <button aria-pressed={tab === 'log'} onClick={() => setTab('log')}>
            Event log
          </button>
        </nav>
        <p className={`stream stream-${state}`} role="status">
          <span className="stream-dot" aria-hidden="true" />
          {STREAM_LABEL[state]}
          {live > 0 && <span className="mono"> · {live} on the line</span>}
        </p>
      </header>

      {tab === 'calls' ? (
        <main className="desk">
          <aside className="desk-list" aria-label="Calls">
            <h2 className="eyebrow">Calls</h2>
            <CallList calls={calls} selected={selected?.callSid} onSelect={setSelectedSid} />
          </aside>
          <section className="desk-chart">
            <CallView call={selected} />
          </section>
        </main>
      ) : (
        <main className="desk-log">
          <EventLog liveEvents={liveEvents} onOpenCall={openCall} />
        </main>
      )}
    </div>
  )
}
