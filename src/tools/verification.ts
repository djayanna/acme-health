/**
 * Caller verification — first name, last name and date of birth against the sample
 * patient directory.
 *
 * The scheduling tools refuse to run until this succeeds, so verification is enforced
 * in code, not just asked for in the prompt. Three failed attempts lock it for the call.
 */

import { PATIENTS } from '../data/patients.js'
import type { Tool } from '../llm/index.js'
import type { CallContext } from '../tac/index.js'

const MAX_ATTEMPTS = 3

// Case, spacing, hyphens and apostrophes don't matter: "o'neil" = "O'Neil" = "oneil".
const normalize = (s: string) => s.trim().toLowerCase().replace(/[\s'’-]+/g, '')

type Args = { firstName: string; lastName: string; dateOfBirth: string }

export function verifyCaller({ firstName, lastName, dateOfBirth }: Args, ctx: CallContext) {
  if (ctx.verifiedPatientId) return { verified: true }
  if (ctx.failedVerifications >= MAX_ATTEMPTS) {
    return { verified: false, locked: true, instruction: 'Do not retry. Offer to transfer the caller to the office.' }
  }
  const patient = PATIENTS.find(
    (p) =>
      normalize(p.firstName) === normalize(firstName) &&
      normalize(p.lastName) === normalize(lastName) &&
      p.dateOfBirth === dateOfBirth.trim(),
  )
  if (!patient) {
    ctx.failedVerifications++
    // Same answer for "no such name" and "wrong date of birth" — don't confirm who is a patient.
    return { verified: false, attemptsLeft: MAX_ATTEMPTS - ctx.failedVerifications }
  }
  ctx.verifiedPatientId = patient.id
  // First name only, so the agent can address the caller — nothing else from the record.
  return { verified: true, firstName: patient.firstName }
}

export const TOOLS: Tool<CallContext>[] = [
  {
    name: 'verify_caller',
    description:
      "Verify the caller's identity before discussing or changing any appointment. Ask for their first name, last name and date of birth first.",
    parameters: {
      type: 'object',
      properties: {
        firstName: { type: 'string', description: "The caller's first name." },
        lastName: { type: 'string', description: "The caller's last name." },
        dateOfBirth: { type: 'string', description: 'Date of birth as YYYY-MM-DD.' },
      },
      required: ['firstName', 'lastName', 'dateOfBirth'],
    },
    run: verifyCaller,
  },
]
