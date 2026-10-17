/**
 * Which chat model the agent runs — picked by `LLM_MODEL`, built through LangChain.
 *
 *   LLM_MODEL=anthropic:claude-opus-5-5   (default)
 *   LLM_MODEL=openai:gpt-5.4-mini
 *   LLM_MODEL=google-genai:gemini-3-flash  (after `npm install @langchain/google-genai`)
 *
 * Any provider LangChain's `initChatModel` supports works once its `@langchain/*`
 * package is installed and its API key is in the environment. `@langchain/anthropic`
 * and `@langchain/openai` ship with this app.
 *
 * Claude gets its tuned settings (effort, refusal fallbacks, prompt caching). Other
 * providers run with their defaults plus LLM_MAX_TOKENS.
 */

import { ChatAnthropic } from '@langchain/anthropic'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { initChatModel } from 'langchain'

const DEFAULT_MODEL = 'anthropic:claude-opus-5-5'
const MAX_TOKENS = Number(process.env.LLM_MAX_TOKENS || 16000)

/** "provider:model" from LLM_MODEL, defaulting the provider to anthropic. */
export function modelSpec(): { provider: string; model: string } {
  // `||` (not `??`): .env.example ships LLM_MODEL= (empty), which is not a model.
  const spec = process.env.LLM_MODEL || DEFAULT_MODEL
  const i = spec.indexOf(':')
  return i === -1 ? { provider: 'anthropic', model: spec } : { provider: spec.slice(0, i), model: spec.slice(i + 1) }
}

/** Claude, tuned for a latency-sensitive voice agent. */
function claude(model: string): ChatAnthropic {
  const effort = (process.env.ANTHROPIC_EFFORT || 'low') as 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  return new ChatAnthropic({
    model,
    maxTokens: MAX_TOKENS,
    streaming: true,
    outputConfig: { effort },
    // On a safety-classifier decline, the API re-runs the turn on Anthropic's
    // recommended fallback model instead of returning the refusal.
    betas: ['server-side-fallback-2026-07-01'],
    invocationKwargs: { fallbacks: 'default', cache_control: { type: 'ephemeral' } },
  })
}

export async function createChatModel(): Promise<BaseChatModel> {
  const { provider, model } = modelSpec()
  if (provider === 'anthropic') return claude(model)
  return (await initChatModel(model, { modelProvider: provider, maxTokens: MAX_TOKENS, streaming: true })) as unknown as BaseChatModel
}
