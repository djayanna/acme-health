/** Appointment scheduling against the sample calendar (`src/data/calendar.ts`). */

import { BOOKINGS, SLOT_TIMES } from '../data/calendar.js'
import type { Tool } from '../llm/index.js'


/** Open slots for a day: the fixed slot times minus what's booked. */
export function checkAvailability(day: string): string[] {
  return SLOT_TIMES.map((time) => `${day} ${time}`).filter((s) => !BOOKINGS.has(s))
}

/** Reserve a slot; false if already taken. */
export function bookAppointment(slot: string, name: string): boolean {
  if (BOOKINGS.has(slot)) return false
  BOOKINGS.set(slot, name)
  return true
}

/** Move a booking to a new open slot. */
export function rescheduleAppointment(oldSlot: string, newSlot: string, name: string): boolean {
  if (BOOKINGS.has(newSlot) || !BOOKINGS.has(oldSlot)) return false
  BOOKINGS.delete(oldSlot)
  BOOKINGS.set(newSlot, name)
  return true
}

/** Release a booked slot. */
export function cancelAppointment(slot: string): boolean {
  return BOOKINGS.delete(slot)
}

export const TOOLS: Tool[] = [
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
    name: 'book_appointment',
    description: 'Book an open slot for the caller. Confirm the details before calling this.',
    parameters: {
      type: 'object',
      properties: {
        slot: { type: 'string', description: 'Slot to book, e.g. "Thursday 10:30".' },
        name: { type: 'string', description: "The caller's name." },
      },
      required: ['slot', 'name'],
    },
    run: ({ slot, name }: { slot: string; name: string }) => ({ booked: bookAppointment(slot, name) }),
  },
  {
    name: 'reschedule_appointment',
    description: 'Move an existing booking to a new open slot.',
    parameters: {
      type: 'object',
      properties: {
        oldSlot: { type: 'string' },
        newSlot: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['oldSlot', 'newSlot', 'name'],
    },
    run: ({ oldSlot, newSlot, name }: { oldSlot: string; newSlot: string; name: string }) => ({
      rescheduled: rescheduleAppointment(oldSlot, newSlot, name),
    }),
  },
  {
    name: 'cancel_appointment',
    description: 'Cancel an existing booking by its slot.',
    parameters: {
      type: 'object',
      properties: { slot: { type: 'string' } },
      required: ['slot'],
    },
    run: ({ slot }: { slot: string }) => ({ cancelled: cancelAppointment(slot) }),
  },
]

