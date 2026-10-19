/**
 * The current date and time, as a line for the system prompt.
 *
 * Computed once when a call starts and fixed for that call: the system prompt must stay
 * byte-identical mid-call (the agent's history is append-only), and a call lasts minutes.
 * Uses the clinic's time zone (CLINIC_TIMEZONE, default America/New_York), not the
 * server's, so "tomorrow" and "this afternoon" mean the clinic's tomorrow.
 */

export const CLINIC_TIMEZONE = process.env.CLINIC_TIMEZONE || 'America/New_York'

/** e.g. "Sunday, October 18, 2026, 2:05 PM EDT (2026-10-18)". */
export function nowLine(now = new Date()): string {
  const spoken = now.toLocaleString('en-US', {
    timeZone: CLINIC_TIMEZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
  // en-CA formats as YYYY-MM-DD — the form the scheduling tools use.
  const iso = now.toLocaleDateString('en-CA', { timeZone: CLINIC_TIMEZONE })
  return `It is now ${spoken} (${iso}). Use this to work out dates like "tomorrow" or "next Tuesday".`
}
