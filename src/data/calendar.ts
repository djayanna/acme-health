/**
 * In-memory appointment calendar — generated sample data for the scheduling tools.
 *
 * Covers the next CALENDAR_DAYS clinic days from today, on the clinic's schedule (see
 * docs/knowledge/acme-health-faq.md): Monday–Friday 9:00, 10:30, 14:00, 15:30;
 * Saturday mornings 9:00 and 10:30; closed Sundays. About half the slots are booked by
 * other (unlisted) patients, and each sample patient has exactly one upcoming
 * appointment — so "what are my appointments?" has a single, clear answer.
 *
 * Generation is seeded by the date, so a restart on the same day gives the same calendar.
 * Resets on restart. Replace with the real scheduling backend.
 */

import { CLINIC_TIMEZONE } from '../prompts/clock.js'
import { PATIENTS } from './patients.js'

/** Bookable times on a weekday. */
export const WEEKDAY_TIMES = ['09:00', '10:30', '14:00', '15:30']
/** Saturday is mornings only (the clinic closes at 1 pm). */
export const SATURDAY_TIMES = ['09:00', '10:30']
/** How far ahead the calendar goes, in clinic days. */
export const CALENDAR_DAYS = 14
/** Share of slots already booked. */
const BOOKED_SHARE = 0.5

/** Bookings that belong to patients outside the sample directory — never verifiable. */
export const OTHER_PATIENT = 'pt-other'

export interface Appointment {
  patientId: string
  /** Visit type, for demo realism. Not health information. */
  reason: 'Annual physical' | 'Follow-up visit' | 'Sick visit' | 'Vaccination' | 'Lab work' | 'Video visit'
}

const REASONS: Appointment['reason'][] = [
  'Annual physical',
  'Follow-up visit',
  'Sick visit',
  'Vaccination',
  'Lab work',
  'Video visit',
]

/** Booked slots: "YYYY-MM-DD HH:MM" → appointment. */
export const BOOKINGS = new Map<string, Appointment>()

/** A clinic day in the calendar. */
export interface ClinicDay {
  /** YYYY-MM-DD, local time. */
  date: string
  /** e.g. "Thursday". */
  weekday: string
  times: string[]
}

/** Today's date in the clinic's time zone, as YYYY-MM-DD. */
const clinicToday = (now: Date) => now.toLocaleDateString('en-CA', { timeZone: CLINIC_TIMEZONE })

/**
 * The next CALENDAR_DAYS clinic days, starting tomorrow in the clinic's time zone
 * (today's slots may have passed). Dates are calendar dates, worked in UTC so a
 * daylight-saving change can't skip or repeat a day.
 */
export function clinicDays(from = new Date()): ClinicDay[] {
  const days: ClinicDay[] = []
  const d = new Date(`${clinicToday(from)}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  while (days.length < CALENDAR_DAYS) {
    const dow = d.getUTCDay()
    if (dow !== 0) {
      days.push({
        date: d.toISOString().slice(0, 10),
        weekday: d.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
        times: dow === 6 ? SATURDAY_TIMES : WEEKDAY_TIMES,
      })
    }
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return days
}

/** Small deterministic PRNG (mulberry32), so the same day yields the same calendar. */
function seeded(seed: number): () => number {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Fill BOOKINGS for the calendar window. */
function generate(): void {
  const days = clinicDays()
  const random = seeded(Number(days[0].date.replace(/-/g, '')))
  const slots = days.flatMap((day) => day.times.map((time) => `${day.date} ${time}`))
  const pick = <T,>(items: T[]) => items[Math.floor(random() * items.length)]

  // Each sample patient has one upcoming appointment, spread through the window, so any
  // of them can demo "what are my appointments?" or rescheduling.
  PATIENTS.forEach((patient, i) => {
    const slot = slots[Math.floor(((i + 0.5) / PATIENTS.length) * slots.length)]
    BOOKINGS.set(slot, { patientId: patient.id, reason: pick(REASONS) })
  })

  // Then fill about half of what's left with other patients' visits.
  for (const slot of slots) {
    if (!BOOKINGS.has(slot) && random() < BOOKED_SHARE) {
      BOOKINGS.set(slot, { patientId: OTHER_PATIENT, reason: pick(REASONS) })
    }
  }
}
generate()
