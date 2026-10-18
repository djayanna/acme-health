/**
 * Every route plugin this app's handlers serve — `app.ts` registers each one.
 *
 * Generated: rebuilt from the files under `src/handlers/` and `src/tools/` on every
 * generation. Add a handler module that exports `routes` and it is listed here.
 */

import type { FastifyPluginAsync } from 'fastify'

import { routes as voiceAgentRoutes } from './voiceAgent.js'
import { routes as warmTransferRoutes } from '../tools/warmTransfer.js'
import { routes as transcriptRoutes } from '../transcripts/routes.js'

export const ROUTES: FastifyPluginAsync[] = [voiceAgentRoutes, warmTransferRoutes, transcriptRoutes]
