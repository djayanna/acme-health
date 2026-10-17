/**
 * Server entry — acme-health.
 *
 * Twilio Agent Connect's `TACServer` (Fastify) serves the voice routes — `POST /twiml`,
 * the ConversationRelay WebSocket, the relay and call-event callbacks — and validates
 * the Twilio signature on each. The app's own routes (`src/handlers/`, the events feed,
 * the health check) are registered on the same Fastify instance. See CLAUDE.md.
 */

import 'dotenv/config'
import formbody from '@fastify/formbody'
import Fastify from 'fastify'
import { TACServer } from 'twilio-agent-connect'

// Observability is always on: every app records its Twilio events (§6).
import { initStore, routes as eventsRoutes } from './observability.js'
import { tac } from './tac/index.js'
import { ROUTES } from './handlers/index.js'

const app = Fastify({ logger: true, trustProxy: true })
// Twilio webhooks are form-encoded. TACServer registers this too, but only at start().
await app.register(formbody)

app.get('/health', async () => ({ status: 'ok' }))

initStore() // create the events table before serving (§6)
await app.register(eventsRoutes) // GET /events (§6)

for (const routes of ROUTES) await app.register(routes) // the app's own handlers (src/handlers/)

const port = Number(process.env.PORT ?? 8080)
const server = new TACServer(tac, { fastifyInstance: app, host: '0.0.0.0', port })
await server.start()
