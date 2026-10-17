/**
 * Knowledge-base answers for general questions (hours, parking, location, insurance).
 *
 * In orchestrated mode with TWILIO_KNOWLEDGE_BASE_ID set, this searches Twilio
 * Enterprise Knowledge through TAC. Otherwise (ConversationRelay-only mode, or no
 * knowledge base) it falls back to the sample answers in `src/data/clinicKnowledge.ts`.
 */

import { KNOWLEDGE_BASE } from '../data/clinicKnowledge.js'
import type { Tool } from '../llm/index.js'
import { tac } from '../tac/index.js'

const KNOWLEDGE_BASE_ID = process.env.TWILIO_KNOWLEDGE_BASE_ID || undefined
const TOP_K = 3

/** A sample-data answer for the question, or undefined when it isn't covered — so the
 * agent says it doesn't know and offers a person, rather than guessing. */
export function sampleLookup(question: string): string | undefined {
  const text = question.toLowerCase()
  for (const [key, answer] of Object.entries(KNOWLEDGE_BASE)) {
    if (text.includes(key)) return answer
  }
  return undefined
}

export async function knowledgeLookup(question: string): Promise<{ answer: string | null } | { passages: string[] }> {
  const client = tac.getKnowledgeClient() // null in ConversationRelay-only mode
  if (client && KNOWLEDGE_BASE_ID) {
    const chunks = await client.searchKnowledgeBase(KNOWLEDGE_BASE_ID, question, TOP_K)
    return { passages: chunks.map((c) => c.content) }
  }
  return { answer: sampleLookup(question) ?? null }
}

export const TOOLS: Tool[] = [
  {
    name: 'knowledge_lookup',
    description:
      'Look up a general clinic question (hours, parking, location, insurance) in the clinic knowledge base. Answer only from what it returns; an empty or null result means the question is not covered.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: "The caller's question." } },
      required: ['question'],
    },
    run: ({ question }: { question: string }) => knowledgeLookup(question),
  },
]
