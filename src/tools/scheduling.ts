/**
 * Appointment scheduling against the sample calendar (`src/data/calendar.ts`).
 *
 * Checking open slots needs no identity. Everything that reads or changes a booking
 * requires a verified caller (`verify_caller`) and only touches that patient's own
 * appointments.
 */

import { BOOKINGS, SLOT_TIMES } from '../data/calendar.js'
import type { Tool } from '../llm/index.js'
import type { CallContext } from '../tac/index.js'

const NOT_VERIFIED = { error: 'Caller is not verified. Use verify_caller first.' }

/** Open slots for a day: the fixed slot times minus what's booked. */
export function checkAvailability(day: string): string[] {
  return SLOT_TIMES.map((time) => `${day} ${time}`).filter((s) => !BOOKINGS.has(s))
}

/** The verified patient's own booked slots. */
export function listAppointments(patientId: string): string[] {
  return [...BOOKINGS].filter(([, owner]) => owner === patientId).map(([slot]) => slot)
}

/** Reserve a slot; false if already taken. */
export function bookAppointment(slot: string, patientId: string): boolean {
  if (BOOKINGS.has(slot)) return false
  BOOKINGS.set(slot, patientId)
  return true
}

/** Move one of the patient's bookings to a new open slot. */
export function rescheduleAppointment(oldSlot: string, newSlot: string, patientId: string): boolean {
  if (BOOKINGS.get(oldSlot) !== patientId || BOOKINGS.has(newSlot)) return false
  BOOKINGS.delete(oldSlot)
  BOOKINGS.set(newSlot, patientId)
  return true
}

/** Release one of the patient's booked slots. */
export function cancelAppointment(slot: string, patientId: string): boolean {
  return BOOKINGS.get(slot) === patientId && BOOKINGS.delete(slot)
}

/** Run `fn` with the verified patient id, or report that verification is needed. */
function asVerified<A, R>(fn: (args: A, patientId: string) => R) {
  return (args: A, ctx: CallContext) => (ctx.verifiedPatientId ? fn(args, ctx.verifiedPatientId) : NOT_VERIFIED)
}

const SLOT = { type: 'string', description: 'A slot as "<Day> <HH:MM>", e.g. "Thursday 10:30".' }

export const TOOLS: Tool<CallContext>[] = [
  {
    name: 'check_availability',
    description: 'List open appointment slots for a given day (e.g. "Thursday").',
    parameters: {
      type: 'object',
      properties: { day: { type: 'string', description: 'Day to check, e.g. "Thursday".' } },
      required: ['day'],
    },
    run: ({ day }: { day: string }) => ({ slots: checkAvailability(day) }),
  },
  {
    name: 'list_my_appointments',
    description: "List the verified caller's upcoming appointments.",
    parameters: { type: 'object', properties: {}, required: [] },
    run: asVerified((_args: Record<string, never>, patientId) => ({ appointments: listAppointments(patientId) })),
  },
  {
    name: 'book_appointment',
    description: 'Book an open slot for the verified caller. Confirm the slot with the caller before calling this.',
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
