/** Knowledge-base answers for general questions (hours, parking, location, insurance). */

import { KNOWLEDGE_BASE } from '../data/clinicKnowledge.js'
import type { Tool } from '../llm/index.js'


/** A knowledge-base answer for the question, or undefined when it isn't covered — so
 * the agent says it doesn't know and offers a person, rather than guessing. */
export function knowledgeLookup(question: string): string | undefined {
  const text = question.toLowerCase()
  for (const [key, answer] of Object.entries(KNOWLEDGE_BASE)) {
    if (text.includes(key)) return answer
  }
  return undefined
}

export const TOOLS: Tool[] = [
  {
    name: 'knowledge_lookup',
    description:
      'Answer a general question (hours, parking, location, insurance) from the clinic knowledge base. Returns null when the question is not covered.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: "The caller's question." } },
      required: ['question'],
    },
    run: ({ question }: { question: string }) => ({ answer: knowledgeLookup(question) ?? null }),
  },
]

