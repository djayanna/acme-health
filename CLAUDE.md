# Agent brief — acme-health

You are working inside a Twilio workshop demo, originally scaffolded by
`workshop-demo-generator` and since moved onto **Twilio Agent Connect (TAC)**. The
Twilio wiring and module structure are in place. Your job is to finish the
use-case-specific logic (persona, business rules, sample data) **without breaking the
layering**.

## Non-negotiables

- **Never invent Twilio endpoints, parameters, or SDK methods.** Before writing any
  Twilio call, use the Twilio docs MCP server registered in `.mcp.json`:
  - `twilio__search` for the right endpoint/operator/property
  - `twilio__retrieve` for the exact request/response schema
- **Never invent TAC APIs either.** Check `node_modules/twilio-agent-connect/dist/index.d.ts`
  for the exact class, method and option names before using one. Prefer what TAC
  already does (TwiML, the WebSocket, prompt queueing, interrupts, signature checks on
  its own routes, memory, Studio handoff) over hand-rolling it.
- **TAC and Fastify are the only server.** `TACServer` serves the voice routes; the
  app's own routes are Fastify plugins registered on the same instance. No Express.
- **Both TAC modes must keep working.** `TWILIO_CONVERSATION_CONFIGURATION_ID` unset =
  ConversationRelay-only; set = orchestrated (Conversation Orchestrator + Memory).
  Anything mode-dependent checks `orchestrated` / `studioHandoffEnabled` from
  `src/tac/` and falls back in relay-only mode (`getMemoryClient()` and
  `getKnowledgeClient()` return `null` there; `createStudioHandoffTool` throws).
- **Layering.** Code is laid out by role. `src/tac/` holds the TAC instance and voice
  channel; `src/handlers/` the agent's TAC callbacks (one module per scenario, plus
  webhook-only handlers); `src/prompts/` one system prompt per scenario; `src/tools/`
  the tools the agent calls mid-conversation; `src/llm/` the Claude adapter;
  `src/data/` clearly fake sample data. Twilio calls TAC doesn't cover are made in the
  handler or tool itself, through `getClient()`.
- **Every Twilio-facing route checks the signature.** TAC's routes do it themselves;
  register the app's own webhooks with `{ preHandler: requireTwilioSignature }`.
- **Routes are registered for you.** `src/handlers/index.ts` lists every `routes`
  plugin exported under `src/handlers/` and `src/tools/`, and `app.ts` registers the
  list.
- **Add-on tools reach the agent for you.** `src/tools/index.ts`'s `SHARED_TOOLS`
  collects the `TOOLS` of every add-on tool module, and each scenario's agent adds
  `SHARED_TOOLS` to its own tools. Every module under `src/tools/` exports `TOOLS`.
  Tools are sent with `strict: true`, so every property must be in `required`.
- **Keep Claude's history append-only.** Never edit or reorder earlier messages, the
  system prompt or the tool list mid-call — Claude Opus 5.5 rejects replayed thinking
  after an edit. Pass assistant content back exactly as the API returned it.
- **Patient data stays fake and gated.** Anything that reads or changes an
  appointment requires `ctx.verifiedPatientId` (set by `verify_caller`). Never commit
  real PHI.
- **Secrets from environment only.** Read via `process.env` after `dotenv/config`.
  Never hard-code an API key or SID.
- **Human-readable code.** Small, well-named modules; refactor long files.
- **Do not modify:**
  - `src/twilioClient.ts` — the SDK/REST abstraction. Import `getClient` from it.
  - `.mcp.json`, `PROMPT.md`, this file.

## Where things live

```
src/
  app.ts                 # Fastify entry — TACServer + the app's own routes
  tac/                   # TAC instance, voice channel, CallContext, publicUrl, signature check
  llm/                   # Claude adapter — streaming tool-use loop (runTurn)
  twilioClient.ts        # SDK-or-REST access layer (do not modify)
  observability.ts       # events store + emitEvent + GET /events
  handlers/              # The agent's TAC callbacks — one module per scenario
  prompts/               # One system prompt per scenario
  tools/                 # Agent tools; `SHARED_TOOLS` (index) holds the add-ons'
  data/                  # Clearly fake sample data
```

## Language + access

- Language: **typescript** (Node **22.13+**, TAC's minimum — see `.nvmrc`)
- Twilio access mode: **sdk**, via Twilio Agent Connect
- Agent LLM provider: **Anthropic — Claude** (`claude-opus-5-5` by default)
