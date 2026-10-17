/**
 * Caller verification — name + date of birth against the sample patient directory.
 *
 * The scheduling tools refuse to run until this succeeds, so verification is enforced
 * in code, not just asked for in the prompt. Three failed attempts lock it for the call.
 */

import { PATIENTS } from '../data/patients.js'
import type { Tool } from '../llm/index.js'
import type { CallContext } from '../tac/index.js'

const MAX_ATTEMPTS = 3

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

export function verifyCaller({ name, dateOfBirth }: { name: string; dateOfBirth: string }, ctx: CallContext) {
  if (ctx.verifiedPatientId) return { verified: true }
  if (ctx.failedVerifications >= MAX_ATTEMPTS) {
    return { verified: false, locked: true, instruction: 'Do not retry. Offer to transfer the caller to the office.' }
  }
  const patient = PATIENTS.find(
    (p) => normalize(p.name) === normalize(name) && p.dateOfBirth === dateOfBirth.trim(),
  )
  if (!patient) {
    ctx.failedVerifications++
    // Same answer for "no such name" and "wrong date of birth" — don't confirm who is a patient.
    return { verified: false, attemptsLeft: MAX_ATTEMPTS - ctx.failedVerifications }
  }
  ctx.verifiedPatientId = patient.id
  return { verified: true }
}

export const TOOLS: Tool<CallContext>[] = [
  {
    name: 'verify_caller',
    description:
      "Verify the caller's identity before discussing or changing any appointment. Ask for their full name and date of birth first.",
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: "The caller's full name as they said it." },
        dateOfBirth: { type: 'string', description: 'Date of birth as YYYY-MM-DD.' },
      },
      required: ['name', 'dateOfBirth'],
    },
    run: verifyCaller,
  },
]
