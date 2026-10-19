/**
 * Appointment scheduling against the sample calendar (`src/data/calendar.ts`).
 *
 * Checking open slots needs no identity. Everything that reads or changes a booking
 * requires a verified caller (`verify_caller`) and only touches that patient's own
 * appointments.
 *
 * Slots are "YYYY-MM-DD HH:MM". Tools also return a spoken form ("Friday, October 23 at
 * 2 PM") for the agent to read back, and accept a weekday name or a date when
 * looking up availability.
 */

import { BOOKINGS, clinicDays, type ClinicDay } from '../data/calendar.js'
import type { Tool } from '../llm/index.js'
import type { CallContext } from '../tac/index.js'

const NOT_VERIFIED = { error: 'Caller is not verified. Use verify_caller first.' }

/** "2026-10-23 14:00" → "Friday, October 23 at 2 PM" — how a receptionist says it. */
export function spoken(slot: string): string {
  const [date, time] = slot.split(' ')
  // Slots are clinic wall-clock times; format them as-is (UTC in, UTC out) so the
  // server's own time zone can't shift the day or hour.
  const d = new Date(`${date}T${time}:00Z`)
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })
  const at = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' }).replace(':00', '')
  return `${day} at ${at}`
}

const describe = (slot: string) => ({ slot, when: spoken(slot) })

/** Clinic days matching a weekday name ("thursday") or an ISO date; all days when empty. */
function matchingDays(day: string | undefined): ClinicDay[] {
  const days = clinicDays()
  const q = day?.trim().toLowerCase()
  if (!q) return days
  if (/^\d{4}-\d{2}-\d{2}$/.test(q)) return days.filter((d) => d.date === q)
  return days.filter((d) => d.weekday.toLowerCase().startsWith(q.slice(0, 3)))
}

/** Open slots for a day (weekday name or date), soonest first. */
export function checkAvailability(day?: string): Array<{ slot: string; when: string }> {
  return matchingDays(day)
    .flatMap((d) => d.times.map((time) => `${d.date} ${time}`))
    .filter((slot) => !BOOKINGS.has(slot))
    .map(describe)
}

/** The verified patient's own upcoming appointments. */
export function listAppointments(patientId: string) {
  return [...BOOKINGS]
    .filter(([, appt]) => appt.patientId === patientId)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([slot, appt]) => ({ ...describe(slot), type: appt.reason }))
}

const isSlot = (slot: string) => clinicDays().some((d) => d.times.some((t) => slot === `${d.date} ${t}`))

/** Reserve an open slot; false if it's taken or not a clinic slot. */
export function bookAppointment(slot: string, patientId: string): boolean {
  if (!isSlot(slot) || BOOKINGS.has(slot)) return false
  BOOKINGS.set(slot, { patientId, reason: 'Follow-up visit' })
  return true
}

/** Move one of the patient's bookings to a new open slot. */
export function rescheduleAppointment(oldSlot: string, newSlot: string, patientId: string): boolean {
  const appt = BOOKINGS.get(oldSlot)
  if (appt?.patientId !== patientId || !isSlot(newSlot) || BOOKINGS.has(newSlot)) return false
  BOOKINGS.delete(oldSlot)
  BOOKINGS.set(newSlot, appt)
  return true
}

/** Release one of the patient's booked slots. */
export function cancelAppointment(slot: string, patientId: string): boolean {
  return BOOKINGS.get(slot)?.patientId === patientId && BOOKINGS.delete(slot)
}

/** Run `fn` with the verified patient id, or report that verification is needed. */
function asVerified<A, R>(fn: (args: A, patientId: string) => R) {
  return (args: A, ctx: CallContext) => (ctx.verifiedPatientId ? fn(args, ctx.verifiedPatientId) : NOT_VERIFIED)
}

const SLOT = {
  type: 'string',
  description: 'A slot exactly as returned by check_availability or list_my_appointments, "YYYY-MM-DD HH:MM".',
}

export const TOOLS: Tool<CallContext>[] = [
  {
    name: 'check_availability',
    description:
      'List open appointment slots in the next two weeks. Pass a weekday name (e.g. "Thursday") or a date (YYYY-MM-DD), or an empty string for the soonest openings. Read back the `when` field; book with the `slot` field.',
    parameters: {
      type: 'object',
      properties: { day: { type: 'string', description: 'Weekday name, YYYY-MM-DD date, or empty for any day.' } },
      required: ['day'],
    },
    run: ({ day }: { day: string }) => {
      const slots = checkAvailability(day)
      // Keep the reply short enough to read aloud: the first few openings.
      return { slots: slots.slice(0, 6), more: Math.max(0, slots.length - 6) }
    },
  },
  {
    name: 'list_my_appointments',
    description: "List the verified caller's upcoming appointments, soonest first.",
    parameters: { type: 'object', properties: {}, required: [] },
    run: asVerified((_args: Record<string, never>, patientId) => ({ appointments: listAppointments(patientId) })),
  },
  {
    name: 'book_appointment',
    description: 'Book an open slot for the verified caller. Read the time back and get a yes before calling this.',
    parameters: { type: 'object', properties: { slot: SLOT }, required: ['slot'] },
    run: asVerified(({ slot }: { slot: string }, patientId) => ({ booked: bookAppointment(slot, patientId) })),
  },
  {
    name: 'reschedule_appointment',
    description: "Move one of the verified caller's bookings to a new open slot. Confirm first.",
    parameters: {
      type: 'object',
      properties: { oldSlot: SLOT, newSlot: SLOT },
      required: ['oldSlot', 'newSlot'],
    },
    run: asVerified(({ oldSlot, newSlot }: { oldSlot: string; newSlot: string }, patientId) => ({
      rescheduled: rescheduleAppointment(oldSlot, newSlot, patientId),
    })),
  },
  {
    name: 'cancel_appointment',
    description: "Cancel one of the verified caller's bookings. Confirm first.",
    parameters: { type: 'object', properties: { slot: SLOT }, required: ['slot'] },
    run: asVerified(({ slot }: { slot: string }, patientId) => ({ cancelled: cancelAppointment(slot, patientId) })),
  },
]
