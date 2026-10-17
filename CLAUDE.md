# Agent brief — acme-health

You are working inside a Twilio workshop demo scaffolded by
`workshop-demo-generator`. The scaffold, all Twilio wiring, and the module structure
are already in place. Your job is to finish the use-case-specific logic (persona,
business rules, sample data) **without breaking the layering**.

## Non-negotiables

- **Never invent Twilio endpoints, parameters, or SDK methods.** Before writing any
  Twilio call, use the Twilio docs MCP server registered in `.mcp.json`:
  - `twilio__search` for the right endpoint/operator/property
  - `twilio__retrieve` for the exact request/response schema
- **Layering.** Code is laid out by role. `src/handlers/` holds the routes Twilio
  calls (one module per scenario, plus webhook-only handlers); `src/prompts/` one
  system prompt per scenario; `src/tools/` the tools the agent calls mid-conversation;
  `src/data/` clearly fake sample data. All of them import the Twilio packages
  (`src/<package>/`) when a package covers the call; Twilio calls no package covers
  are made in the handler or tool itself, through the Twilio client.
- **Routers are mounted for you.** `src/handlers/index.ts` is generated: it lists every
  `router` exported under `src/handlers/` and `src/tools/`, and `app` mounts the list.
- **Add-on tools reach the agent for you.** `src/tools/index.ts` is generated: its
  `SHARED_TOOLS` collects the `TOOLS` of every add-on tool module, and each scenario's
  agent adds `SHARED_TOOLS` to its own tools. Every module under `src/tools/` exports
  `TOOLS` (its list of `Tool`).
- **Secrets from environment only.** Read via `process.env` after `dotenv/config`.
  Never hard-code an API key or SID.
- **Human-readable code.** Small, well-named modules; refactor long files.
- **Do not modify:**
  - `src/twilioClient.ts` — the SDK/REST abstraction. Import `getClient` from it.
  - The component packages (`src/channels/`, `src/relay/`) — the reusable primitives.
  - `.mcp.json`, `PROMPT.md`, this file.

## Where things live

```
src/
  app.ts                 # Express entry — mounts the Twilio packages and `handlers`
  twilioClient.ts        # SDK-or-REST access layer (do not modify)
  channels/              # Channels — reusable Twilio primitive (do not modify)
  relay/                 # ConversationRelay — reusable Twilio primitive (do not modify)
  handlers/              # Routes Twilio calls — one module per scenario
  prompts/               # One system prompt per scenario
  tools/                 # Agent tools; `SHARED_TOOLS` (generated index) holds the add-ons'
  data/                  # Clearly fake sample data
```

## Language + access

- Language: **typescript**
- Twilio access mode: **sdk**
- Agent LLM provider: **Anthropic — Claude**

