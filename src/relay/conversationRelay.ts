/**
 * ConversationRelay — hand a voice call to the app over a WebSocket.
 *
 * Twilio ConversationRelay is Twilio's voice-to-LLM transport. Twilio handles speech
 * recognition and text-to-speech; this app receives each caller turn as text on a
 * WebSocket and sends text back for playback.
 *
 * Public surface:
 *   buildRelayTwiml(opts) -> string     // <Connect><ConversationRelay> TwiML
 *   RelayHandler                        // WebSocket dispatcher — subclass and override hooks
 *   RelayReply                          // frames sent back to Twilio (text / end / …)
 *   registerRelayHandler(cls)           // the handler class /relay/ws uses
 *   RelayToolCtx                        // per-call `ctx` for agent tools (say / end)
 *   attachRelayWebSocket(server)        // mounts WS /relay/ws on the http.Server
 *
 * Routes (exported as `router`, mounted by app.ts):
 *   POST /voice/inbound   → TwiML that connects the call to /relay/ws
 *
 * This module does not call an LLM. A use case subclasses `RelayHandler` and registers it.
 *
 * Docs: https://www.twilio.com/docs/voice/twiml/connect/conversationrelay
 */

import type { Server } from 'http'
import { Router } from 'express'
import twilio from 'twilio'
import { WebSocketServer, type WebSocket } from 'ws'

const WS_PATH = '/relay/ws'

export interface RelayTwimlOptions {
  publicHost?: string
  welcomeGreeting?: string
  voice?: string
  language?: string
  transcriptionProvider?: string
  ttsProvider?: string
  speechModel?: string
  interruptible?: boolean
  interruptByDtmf?: boolean
  intelligenceService?: string
  hints?: string[]
  /**
   * Absolute or relative URL Twilio POSTs when the ConversationRelay session ends
   * (caller hangs up, or the app sends `RelayReply.end(handoffData)`). Use it to
   * continue the call — e.g. a warm transfer that parks the caller in a conference.
   * The request carries `HandoffData`, `SessionStatus` and call info.
   * https://www.twilio.com/docs/voice/twiml/connect/conversationrelay#action-url-callback
   */
  action?: string
}


/**
 * Return the TwiML that hands the call to ConversationRelay.
 *
 * `publicHost` defaults to `$PUBLIC_HOST` (no scheme, no trailing slash); `voice` and
 * `language` default to `$RELAY_VOICE` / `$RELAY_LANGUAGE`.
 */
export function buildRelayTwiml(opts: RelayTwimlOptions = {}): string {
  const host = (opts.publicHost ?? process.env.PUBLIC_HOST ?? '').replace(/\/+$/, '')
  if (!host) {
    throw new Error('PUBLIC_HOST is not set — ConversationRelay needs a wss:// URL Twilio can reach.')
  }
  const attributes: Record<string, string | boolean | undefined> = {
    url: `wss://${host}${WS_PATH}`,
    welcomeGreeting: opts.welcomeGreeting ?? 'Hello — how can I help you today?',
    voice: opts.voice ?? process.env.RELAY_VOICE,
    language: opts.language ?? process.env.RELAY_LANGUAGE,
    transcriptionProvider: opts.transcriptionProvider,
    ttsProvider: opts.ttsProvider,
    speechModel: opts.speechModel,
    interruptible: opts.interruptible ?? true,
    interruptByDtmf: opts.interruptByDtmf ?? true,
    intelligenceService: opts.intelligenceService,
    hints: opts.hints?.length ? opts.hints.join(',') : undefined,
  }

  // TwiML <Connect><ConversationRelay> — only pass attributes that are set. The
  // optional `action` URL belongs on <Connect>, fired when the relay session ends.
  // https://www.twilio.com/docs/voice/twiml/connect/conversationrelay
  const response = new twilio.twiml.VoiceResponse()
  const connect = response.connect(opts.action ? { action: opts.action } : {})
  connect.conversationRelay(
    Object.fromEntries(Object.entries(attributes).filter(([, v]) => v !== undefined)) as any,
  )
  return response.toString()
}


/** Builders for the JSON frames sent back to Twilio. */
export const RelayReply = {
  /** A text chunk for text-to-speech. Stream with `last: false`; the final chunk must be `last: true`. */
  text(token: string, opts: { last?: boolean } = {}): string {
    return JSON.stringify({ type: 'text', token, last: opts.last ?? true })
  },
  /** End the session and return control of the call to Twilio. */
  end(handoffData?: Record<string, unknown>): string {
    return JSON.stringify(
      handoffData === undefined ? { type: 'end' } : { type: 'end', handoffData: JSON.stringify(handoffData) },
    )
  },
  /** Switch the speech languages mid-session. */
  language(ttsLanguage: string, transcriptionLanguage?: string): string {
    return JSON.stringify({ type: 'language', ttsLanguage, transcriptionLanguage: transcriptionLanguage ?? ttsLanguage })
  },
}

export type Send = (frame: string) => void

export type RelayEvent = { type: string; [key: string]: unknown }

/** Per-call state, filled in from Twilio's `setup` frame. */
export interface RelaySession {
  callSid?: string
  sessionId?: string
  customParameters: Record<string, string>
}


/**
 * What an agent tool gets for one relay call: the call, a way to speak, a way to end.
 *
 * The handler builds one per call and passes it as `ctx` to every tool; a tool that
 * ends the session (e.g. a hand-off to a person) calls `end(...)`, and the handler
 * stops issuing turns once `ended` is set.
 */
export class RelayToolCtx {
  ended = false

  constructor(
    readonly send: Send,
    readonly session: RelaySession,
  ) {}

  say(text: string): void {
    this.send(RelayReply.text(text))
  }

  /** End the relay session; Twilio then fetches the TwiML `action` URL, if set. */
  end(handoffData?: Record<string, unknown>): void {
    this.ended = true
    this.send(RelayReply.end(handoffData))
  }
}


/**
 * Dispatch ConversationRelay frames to typed hooks.
 *
 * Subclass it and override the hooks you need — at least `onPrompt` — then register
 * the subclass with `registerRelayHandler`.
 */
export class RelayHandler {
  session: RelaySession = { customParameters: {} }

  async dispatch(raw: string, send: Send): Promise<void> {
    let event: RelayEvent
    try {
      event = JSON.parse(raw)
    } catch {
      console.error('relay: non-JSON frame received')
      return
    }
    switch (event.type) {
      case 'setup':
        this.session = {
          callSid: event.callSid as string | undefined,
          sessionId: event.sessionId as string | undefined,
          customParameters: (event.customParameters as Record<string, string>) ?? {},
        }
        await this.onSetup(event, send)
        break
      case 'prompt':
        await this.onPrompt((event.voicePrompt as string) ?? '', event, send)
        break
      case 'interrupt':
        await this.onInterrupt(event, send)
        break
      case 'dtmf':
        await this.onDtmf((event.digit as string) ?? '', event, send)
        break
      case 'error':
        await this.onError((event.description as string) ?? '', event, send)
        break
    }
  }

  /** Called once per call, right after Twilio's `setup` frame. */
  async onSetup(_event: RelayEvent, _send: Send): Promise<void> {}

  /** Called when the caller finishes a turn. Default: a canned reply. */
  async onPrompt(_transcript: string, _event: RelayEvent, send: Send): Promise<void> {
    send(RelayReply.text('I heard you, but no agent is wired up yet.'))
  }

  /** Caller barged in — cancel any in-flight reply. */
  async onInterrupt(_event: RelayEvent, _send: Send): Promise<void> {}

  /** Caller pressed a key. */
  async onDtmf(_digit: string, _event: RelayEvent, _send: Send): Promise<void> {}

  async onError(description: string, _event: RelayEvent, _send: Send): Promise<void> {
    console.error('relay error:', description)
  }

  /** Called once when the WebSocket closes (call ended or session ended). */
  async onClose(): Promise<void> {}
}


let handlerClass: new () => RelayHandler = RelayHandler

/** Use `cls` for every call on /relay/ws. Only one per app — later calls win. */
export function registerRelayHandler<T extends new () => RelayHandler>(cls: T): T {
  handlerClass = cls
  return cls
}

export const router = Router()

router.post('/voice/inbound', (_req, res) => {
  // Point a Twilio number's Voice webhook here to hand inbound calls to the relay.
  res.type('text/xml').send(buildRelayTwiml())
})


/** Mount the WebSocket ConversationRelay connects to — one handler instance per call. */
export function attachRelayWebSocket(server: Server): void {
  const wss = new WebSocketServer({ server, path: WS_PATH })
  wss.on('connection', (ws: WebSocket) => {
    const handler = new handlerClass()
    const send: Send = (frame) => ws.send(frame)
    ws.on('message', (data) => void handler.dispatch(data.toString(), send))
    ws.on('close', () => void handler.onClose())
  })
}

