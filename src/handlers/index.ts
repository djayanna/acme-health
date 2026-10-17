/**
 * Every router this app's handlers serve — `app.ts` mounts each one.
 *
 * Generated: rebuilt from the files under `src/handlers/` and `src/tools/` on every
 * generation. Add a handler module that exports `router` and it is listed here.
 */

import type { Router } from 'express'

import { router as voiceAgentRouter } from './voiceAgent.js'
import { router as warmTransferRouter } from '../tools/warmTransfer.js'

export const ROUTERS: Router[] = [voiceAgentRouter, warmTransferRouter]
