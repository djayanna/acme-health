/**
 * Channels — Twilio Voice / SMS entry points, outbound dispatch and webhook security.
 *
 * The `channels` package's public surface — import from here, e.g.
 * `import { placeCall } from '../channels/index.js'`.
 */

export {
  placeCall,
  registerSmsHandler,
  onCallCompleted,
  voiceResponse,
  messagingResponse,
  verifySignature,
  verifyJsonSignature,
  publicUrl,
  router,
} from './channels.js'
export type {
  Params,
  SmsHandler,
  CallCompletedHandler,
} from './channels.js'
