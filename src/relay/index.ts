/**
 * ConversationRelay — hand a voice call to the app over a WebSocket.
 *
 * The `relay` package's public surface — import from here, e.g.
 * `import { buildRelayTwiml } from '../relay/index.js'`.
 */

export {
  buildRelayTwiml,
  RelayReply,
  RelayHandler,
  registerRelayHandler,
  RelayToolCtx,
  router,
  attachRelayWebSocket,
} from './conversationRelay.js'
export type {
  RelayTwimlOptions,
  Send,
  RelayEvent,
  RelaySession,
} from './conversationRelay.js'
