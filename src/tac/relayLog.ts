/**
 * Log every frame ConversationRelay sends on the voice WebSocket.
 *
 * TACServer hands each verified ConversationRelay socket to
 * `voiceChannel.handleWebSocketConnection(ws)`. This wraps that method once to add a
 * second `message` listener — TAC's own handling is untouched (and `voiceChannel.on('prompt')`
 * isn't used, because it would replace TAC's prompt handler rather than add to it).
 *
 * Logged through TAC's pino logger as `component: "relay"`, so the lines match the rest
 * of the app's JSON logs. A `prompt` frame logs its metadata — length, lang, last,
 * agentSpeaking — but not what the caller said, unless RELAY_LOG_TRANSCRIPTS=true:
 * spoken words can be PHI. Set RELAY_LOG_FRAMES=false to turn this off.
 *
 * Message reference: https://www.twilio.com/docs/voice/conversationrelay/websocket-messages
 */

import type { TAC, VoiceChannel } from 'twilio-agent-connect'

/** The socket type TAC itself uses for ConversationRelay connections. */
type RelaySocket = Parameters<VoiceChannel['handleWebSocketConnection']>[0]

const enabled = process.env.RELAY_LOG_FRAMES !== 'false'
const withText = process.env.RELAY_LOG_TRANSCRIPTS === 'true'

type Frame = { type?: string; [key: string]: unknown }

/** The fields worth logging for each ConversationRelay message type. */
function describe(frame: Frame): Record<string, unknown> {
  switch (frame.type) {
    case 'setup':
      return { callSid: frame.callSid, sessionId: frame.sessionId, direction: frame.direction, callStatus: frame.callStatus }
    case 'prompt': {
      const text = typeof frame.voicePrompt === 'string' ? frame.voicePrompt : ''
      return {
        chars: text.length,
        words: text.trim() ? text.trim().split(/\s+/).length : 0,
        lang: frame.lang,
        last: frame.last,
        // Set when the caller spoke over the agent: what the agent was saying at the time.
        agentSpeaking: frame.agentSpeaking,
        ...(withText && { voicePrompt: text }),
      }
    }
    case 'interrupt':
      return {
        durationUntilInterruptMs: frame.durationUntilInterruptMs,
        ...(withText && { utteranceUntilInterrupt: frame.utteranceUntilInterrupt }),
      }
    case 'dtmf':
      // Keypresses can be account or card digits: log that one happened, not which key.
      return { digit: withText ? frame.digit : '•' }
    case 'error':
      return { description: frame.description }
    default:
      return {}
  }
}

export function logRelayFrames(tac: TAC, voiceChannel: VoiceChannel): void {
  if (!enabled) return
  const log = tac.logger.child({ component: 'relay' })
  const handle = voiceChannel.handleWebSocketConnection.bind(voiceChannel)

  voiceChannel.handleWebSocketConnection = (ws: RelaySocket) => {
    let callSid: string | undefined
    const opened = Date.now()

    ws.on('message', (data: { toString(): string }) => {
      let frame: Frame
      try {
        frame = JSON.parse(data.toString()) as Frame
      } catch {
        log.warn({ callSid, bytes: data.toString().length }, 'relay: non-JSON frame')
        return
      }
      if (frame.type === 'setup' && typeof frame.callSid === 'string') callSid = frame.callSid
      const level = frame.type === 'error' ? 'warn' : 'info'
      log[level]({ callSid, frame: frame.type, ...describe(frame) }, `relay ← ${frame.type}`)
    })
    ws.on('close', (code: number) => log.info({ callSid, code, durationSec: Math.round((Date.now() - opened) / 1000) }, 'relay socket closed'))

    handle(ws)
  }
}
