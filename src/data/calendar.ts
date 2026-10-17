/**
 * In-memory appointment calendar — sample data for the scheduling tools.
 *
 * Resets on restart. Replace with the real scheduling backend.
 */

/** The bookable times offered on any day. */
export const SLOT_TIMES = ['09:00', '10:30', '14:00', '15:30']

/** Booked slots: "<day> <time>" → caller name. */
export const BOOKINGS = new Map<string, string>()
