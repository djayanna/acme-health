/**
 * Clinic knowledge base — clearly fake sample answers for `knowledge_lookup`.
 *
 * Keys are matched loosely against the caller's words. Replace with a real retrieval
 * source (vector search, Twilio Enterprise Knowledge) when wiring a real backend.
 */

export const KNOWLEDGE_BASE: Record<string, string> = {
  hours: 'The clinic is open weekdays 8am to 6pm and Saturdays 9am to 1pm.',
  parking:
    'Free patient parking is in the garage on 2nd Street; bring your ticket to the front desk to validate.',
  location: "We're at 100 Main Street, Suite 200. The entrance is on the Elm Street side.",
  insurance: 'We accept most major insurance plans. Bring your card and a photo ID to your visit.',
}
