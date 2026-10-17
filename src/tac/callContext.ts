/**
 * What an agent tool gets for one voice call: the TAC session, who the caller has been
 * verified as, and a way to hand the call off.
 *
 * The voice handler builds one per call and passes it as `ctx` to every tool.
 */

import type { ConversationSession } from 'twilio-agent-connect'

export class CallContext {
  /** Set by `verify_caller` once name + date of birth match a patient record. */
  verifiedPatientId?: string
  failedVerifications = 0

  constructor(readonly session: ConversationSession) {}

  get conversationId(): string {
    return this.session.conversationId
  }

  /** True once a handoff is queued or sent — the agent takes no further turns. */
  get handedOff(): boolean {
    return this.handoffSent || this.session.pendingHandoffData !== undefined
  }

  private handoffSent = false

  /**
   * Queue the ConversationRelay `end` frame carrying `handoffData`. The voice handler
   * sends it after the agent's last words finish streaming; Twilio then POSTs the
   * `<Connect action>` URL, which takes the call over.
   */
  requestHandoff(handoffData: Record<string, unknown>): void {
    this.session.pendingHandoffData = { type: 'end', handoffData: JSON.stringify(handoffData) }
  }

  /** Called by the voice handler once the `end` frame has gone out. */
  markHandoffSent(): void {
    this.handoffSent = true
  }
}
