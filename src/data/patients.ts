/**
 * Patient directory — clearly fake sample records for caller verification.
 *
 * Every name and date here is invented. Replace with a lookup against the real
 * practice-management system (and keep real PHI out of this repo).
 */

export interface Patient {
  id: string
  name: string
  /** ISO date, YYYY-MM-DD. */
  dateOfBirth: string
}

export const PATIENTS: Patient[] = [
  { id: 'pt-demo-001', name: 'Jamie Sample', dateOfBirth: '1985-04-12' },
  { id: 'pt-demo-002', name: 'Alex Example', dateOfBirth: '1992-11-03' },
  { id: 'pt-demo-003', name: 'Riley Testcase', dateOfBirth: '1978-07-29' },
]
