import { payloadOf, type CallEvent } from './useCallStream'

/** What kind of moment an event marks — drives its colour on the timeline. */
export type EventKind = 'call' | 'agent' | 'tool' | 'transfer' | 'error'

const TOOL_LABELS: Record<string, string> = {
  verify_caller: 'Checked caller identity',
  check_availability: 'Looked up open slots',
  list_my_appointments: 'Listed caller’s appointments',
  book_appointment: 'Booked an appointment',
  reschedule_appointment: 'Rescheduled an appointment',
  cancel_appointment: 'Cancelled an appointment',
  knowledge_lookup: 'Searched clinic info',
  transfer_to_human: 'Asked to transfer to the office',
}

const METHOD_LABELS: Record<string, string> = {
  'voiceAgent.callStarted': 'Call connected',
  // Fires when the ConversationRelay session closes — at hang-up, or at a handoff.
  'voiceAgent.callEnded': 'AI session ended',
  'voiceAgent.handoff': 'AI handed off',
  'agent.turn': 'Agent replied',
  'warmTransfer.beginTransfer': 'Dialing the office',
  'warmTransfer.officeAccepted': 'Office picked up',
  'warmTransfer.recoverCaller': 'Caller brought back from hold',
}

/** A short, human label for an event. */
export function labelOf(event: CallEvent): string {
  if (event.component === 'agent' && event.method === 'toolCall') {
    const tool = String(payloadOf(event)?.tool ?? '')
    return TOOL_LABELS[tool] ?? `Used ${tool || 'a tool'}`
  }
  if (event.component === 'agent' && event.method === 'turn' && event.event_type === 'interrupted') {
    return 'Caller interrupted the agent'
  }
  return METHOD_LABELS[`${event.component}.${event.method}`] ?? `${event.component} · ${event.method}`
}

export function kindOf(event: CallEvent): EventKind {
  if (event.status === 'error' || event.event_type === 'error') return 'error'
  if (event.component === 'warmTransfer' || event.method === 'handoff') return 'transfer'
  if (event.method === 'toolCall') return 'tool'
  if (event.component === 'agent') return 'agent'
  return 'call'
}

/** A one-line result for the timeline, from the payload's most telling field. */
export function summaryOf(event: CallEvent): string | null {
  const p = payloadOf(event)
  if (!p) return null
  if (event.method === 'toolCall') {
    const outcome = (p.outcome ?? {}) as Record<string, unknown>
    if (outcome.error) return String(outcome.error)
    if ('verified' in outcome) return outcome.verified ? 'verified' : outcome.locked ? 'locked after 3 tries' : 'not verified'
    for (const key of ['booked', 'rescheduled', 'cancelled', 'transferred']) {
      if (key in outcome) return outcome[key] ? 'done' : 'not possible'
    }
    const count = Object.entries(outcome).find(([k]) => k.endsWith('Count'))
    if (count) return `${count[1]} found`
    return null
  }
  if (event.method === 'turn') return typeof p.durationMs === 'number' ? `${(p.durationMs / 1000).toFixed(1)} s` : null
  if (event.method === 'callEnded' && typeof p.durationSec === 'number') return formatDuration(p.durationSec)
  if (event.method === 'recoverCaller' && p.why) return String(p.why)
  if (event.method === 'handoff' && p.reason) return String(p.reason)
  return null
}

export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m ? `${m} min ${s} s` : `${s} s`
}

/** Display form of a payload key: camelCase → words. */
export function keyLabel(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/Ms$/, ' (ms)').replace(/Sec$/, ' (s)').toLowerCase()
}
