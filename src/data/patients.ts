/**
 * Patient directory — clearly fake sample records for caller verification.
 *
 * Every name and date here is invented. Replace with a lookup against the real
 * practice-management system (and keep real PHI out of this repo).
 */

export interface Patient {
  id: string
  firstName: string
  lastName: string
  /** ISO date, YYYY-MM-DD. */
  dateOfBirth: string
}

export const PATIENTS: Patient[] = [
  { id: 'pt-demo-001', firstName: 'Jamie', lastName: 'Sample', dateOfBirth: '1985-04-12' },
  { id: 'pt-demo-002', firstName: 'Alex', lastName: 'Example', dateOfBirth: '1992-11-03' },
  { id: 'pt-demo-003', firstName: 'Riley', lastName: 'Testcase', dateOfBirth: '1978-07-29' },
  { id: 'pt-demo-004', firstName: 'John', lastName: 'Smith', dateOfBirth: '1980-03-15' },
  { id: 'pt-demo-005', firstName: 'Maria', lastName: 'Garcia', dateOfBirth: '1990-08-22' },
  { id: 'pt-demo-006', firstName: 'Sam', lastName: 'Lee', dateOfBirth: '2012-05-30' },
]

export const fullName = (p: Patient) => `${p.firstName} ${p.lastName}`
