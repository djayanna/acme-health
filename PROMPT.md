# Fill the use-case logic of a Twilio demo app

You are finishing a **production-ready Twilio demo app**. The customer will copy its
files straight into their own repo. Everything below this section was generated from
version-controlled templates and is already on disk: the scaffold, the runtime agent,
and every component module with its full source. The use case and features each
come with their brief, walkthrough and (when they ship one) source. Your job is the
use-case-specific layer on top of that.

## Rules

1. **The provided context is the source of truth.** When component source, a brief,
   a walkthrough or a `prompt.md` overlay conflicts with what you know, follow the
   context. Import from the shipped modules and call their real names; never rewrite
   or duplicate a call a component already makes.
2. **Adapt shipped source; don't start over.** When a use-case or feature module is
   included, it is already emitted. Keep its path, routes and public names, and change
   only what the Instructions require (persona, rules, questions, sample data).
   Return each changed file at its given path with no `>>> piece` markers; leave out
   files you don't change. When no module is shipped, write one from the brief and
   walkthrough at the path its block names.
3. **Use cases call into features, never the other way round.** A feature you write
   must work with any use case. A config-only feature adds no file; apply it in the
   use case at the seam its walkthrough names.
4. **Every Twilio call must be real.** A call no component covers goes in your
   use-case or feature code, through the shared `twilio_client`, and you verify it
   first with `twilio__search` / `twilio__retrieve`. Use `list_skills` / `read_skill`
   for a Twilio product the context doesn't already cover. Don't use tools to
   re-check what the context already shows.
5. **Secrets come from the environment only.** Read env vars directly (`os.environ` /
   `process.env`), the way the component modules do. Never hard-code SIDs, keys,
   numbers or hosts. Declare any new var in `env_keys`.
6. **Instrument the Twilio calls you write.** `src/observability` is generated; import
   it, don't rewrite it (Python `from observability import emit_event`; TypeScript
   `import { emitEvent } from './observability.js'`, path relative to your file).
   Around each component call or direct Twilio call in your code, emit `start`
   before it and `success` / `error` after it:
   `emit_event(component, method, event_type, correlation_id=…, status=…, payload=…)`
   (`emitEvent(component, method, eventType, { correlationId, status, payload })`).
   Use the `method` / `event_type` a component block lists. If a call has none, pick
   short names that read well on a wallboard. Put the SID, status or a short summary
   in `payload`. Pass the call / session / conversation SID as `correlation_id` when
   one is in scope, otherwise `None`; never invent one. Keep normal error handling
   around the Twilio call itself.
7. **Readable code.** Match the shipped code's style. Split a file that grows past
   ~200 lines or mixes concerns. No stubs or `TODO`s in runtime paths. Comment only
   the non-obvious *why*.
8. **If you can't verify it, stop.** If a tool you need fails, or you can't confirm a
   Twilio call the app needs, return only `{"error": "<what and why>"}`, with no
   partial files. If this prompt says the SE chose to fill without a tool, use the
   context in its place; still return an error for any call the context doesn't cover.

## What you write

- **The system prompt** for each use case: persona, tone and guardrails, taken from
  its Instructions.
- **Business logic**: how the app answers, when it escalates, what it looks up and
  what it stores.
- **Sample data** in `src/data/`, clearly fake. Replace any bracketed placeholder in
  the Instructions (e.g. `[COMPANY]`) with an obviously fictional value.
- **A demo script**: numbered stage steps for the SE (what to say, what to do, what
  the audience sees). Return it as `demo_script`.

**Write list.** You may write only to `src/handlers/`, `src/prompts/`, `src/tools/`, `src/data/`,
`scripts/` and `frontend/src/panels/`. Every other path is read-only, and any path
outside this list fails the build.

## Output

Return one JSON object and nothing else, with no prose and no code fence:

```json
{
  "files": { "<path relative to project root>": "<full file content>" },
  "demo_script": "1. Call the number …",
  "env_keys": [{ "name": "CLINIC_NAME", "comment": "Shown in the greeting" }]
}
```

- `files` holds only files you create or replace. Each file is UTF-8 with LF line
  endings and a trailing newline.
- `env_keys` may be empty. Never put secret values in it.
- On failure, return `{"error": "..."}` and nothing else.

## Project context

- **Project name:** acme-health (`acme-health`)
- **Language:** typescript
- **Twilio access:** sdk
- **Agent LLM provider:** Anthropic — Claude (`anthropic`)
- **Demo UI:** on
- **Theme:** flex-dark
- **Ports:** backend `8080`, frontend `5174`

**Planned folder tree** — every file the generator will emit. Paths under the write-list in the meta-prompt are yours to create or replace; everything else already exists and is read-only:

```
.env.example
.gitignore
.mcp.json
CLAUDE.md
PROMPT.md
README.md
package.json
run.sh
src/app.ts
src/channels/channels.ts
src/channels/index.ts
src/data/calendar.ts
src/data/clinicKnowledge.ts
src/handlers/index.ts
src/handlers/voiceAgent.ts
src/llm/index.ts
src/llm/openai.ts
src/observability.ts
src/prompts/voiceAgent.ts
src/relay/conversationRelay.ts
src/relay/index.ts
src/tools/index.ts
src/tools/knowledge.ts
src/tools/scheduling.ts
src/tools/warmTransfer.ts
src/twilioClient.ts
tsconfig.json
wallboard/index.html
wallboard/package.json
wallboard/src/App.css
wallboard/src/App.tsx
wallboard/src/main.tsx
wallboard/tsconfig.json
wallboard/vite.config.ts
```

## Runtime agent (already generated — call it, do not rewrite it)

The app ships a streaming OpenAI tool-use loop at `src/llm/`, imported as `import { runTurn, type Tool, type Message } from '../llm/index.js'`. It is **not** the LLM that is generating this project — it is the app's own conversational brain, reading `OPENAI_API_KEY` / `OPENAI_MODEL` from the app's environment.

- `Tool<Ctx>` — `{ name, description, parameters, run(args, ctx) }`. `parameters` is a JSON Schema; `run` may be sync or async and returns a JSON-serialisable result.
- `await runTurn(history, tools, onToken, ctx, isDone?)` — runs one caller turn: streams assistant text through `onToken(token, last)`, dispatches any tool calls, and appends messages to `history` (a `Message[]`) in place. Seed `history` with `{ role: 'system', content: SYSTEM_PROMPT }` once per call. `isDone` is an optional predicate the handler passes to stop the loop early (e.g. after a transfer) — keep it wired as the shipped handler has it.
- `import { SHARED_TOOLS } from '../tools/index.js'` — generated: the tools the selected features give the agent (empty when none do). Every agent's tool list ends with `...SHARED_TOOLS`; never import a feature's tool module directly.

Your job: write `SYSTEM_PROMPT` and the `Tool[]` from the Instructions, and drive each relay turn through `runTurn`. Do not implement your own LLM client or tool-dispatch loop.

## Instructions from the SE

You are the AI voice assistant for [COMPANY]'s patient line. Answer general
questions (locations, hours, parking, visit prep) from the knowledge base — never
guess; if the knowledge base has no answer, say so and offer a human. Help callers
book, reschedule, or cancel appointments by collecting the details one at a time
and confirming before you commit.

Guardrails: you are not a clinician — never give medical advice, diagnoses, dosing,
or triage. Verify the caller's identity (name + date of birth) before discussing
any appointment or personal detail. When the caller asks for a human, needs
clinical judgement, or you cannot resolve the request, hand them to the doctor's
office if you have a tool for it; otherwise say you can't transfer the call and
offer to take a message. Be warm, concise, and plain-spoken.

## Use case: AI voice agent · Inbound

- **Entry point:** inbound on voice
- **Use-case files:** `src/data/calendar.ts`, `src/data/clinicKnowledge.ts`, `src/handlers/voiceAgent.ts`, `src/prompts/voiceAgent.ts`, `src/tools/knowledge.ts`, `src/tools/scheduling.ts` — the entry route and core flow (handler), the persona (prompt), its tools and sample data.

# AI voice agent · Inbound (RAG + scheduling)

An inbound AI voice agent answers patient calls and resolves common requests on its
own; with a hand-off add-on it can also pass the caller to a person. A caller dials
the Twilio number, the call is handed to ConversationRelay, and each spoken turn
reaches the agent over the WebSocket. The agent decides what the caller wants and acts through **tools**:

1. **Answer general questions (RAG).** Locations, hours, parking, visit prep, and
   similar questions are answered from a knowledge base via `knowledge_lookup`, so
   answers stay accurate and current. The agent never guesses — if the knowledge
   base has no answer, it says so and offers a human.

2. **Schedule an appointment.** `check_availability`, `book_appointment`,
   `reschedule_appointment`, and `cancel_appointment` collect the caller's details,
   check provider availability, and commit the change — one question per turn, with a
   confirmation before anything is written.

3. **Hand off to a person — when an add-on supplies it.** The agent runs its own
   tools plus `SHARED_TOOLS`, the tools the selected add-ons give it. With warm
   transfer selected, that includes `transfer_to_human`; without one, the agent says
   it can't transfer the call and offers to take a message. Either way the use case
   runs on its own.

**Entry point:** inbound voice. ConversationRelay owns `/relay/ws`; this use case
owns its inbound TwiML entry route so it can set the greeting and the relay `action`
URL.

**Where the code lives:** the entry route and the agent in `src/handlers/voice_agent`,
the system prompt in `src/prompts/voice_agent`, the tools in `src/tools/` (`knowledge`,
`scheduling`), and the sample data in `src/data/`.

**What the LLM fills:** `knowledge_lookup` and the scheduling tools ship as runnable
**stubs** (static knowledge entries, an in-memory calendar) so the call works end to
end before any backend is wired in. The customer points them at a real knowledge base
and scheduling system. The agent is already conversational — each turn runs the OpenAI
tool-use loop in `src/llm/`; the fill tailors `SYSTEM_PROMPT` and the tool set to the
Instructions.

### Walkthrough (steps.yaml)

```yaml
intro: >
  Answer an inbound call, hand it to ConversationRelay, and let the agent resolve the
  request through tools — knowledge-base answers and appointment scheduling, plus any
  tools the selected add-ons supply (e.g. a warm hand-off to a person). The relay and its WebSocket are shared ConversationRelay
  pieces; the inbound entry route and the agent are a handler, with its system prompt,
  tools and sample data beside it.

steps:
  - kind: console
    step: "Console · Buy number"
    title: "Buy a Twilio voice-capable number"
    body: |
      <p>Patients call this number. Confirm it has <strong>Voice</strong> capability
      and save it as <code>TWILIO_PHONE_NUMBER</code>.</p>
    action:
      label: "Buy a phone number"
      href: "https://console.twilio.com/us1/develop/phone-numbers/manage/search"

  - kind: console
    step: "Console · ConversationRelay"
    title: "Complete ConversationRelay onboarding"
    body: |
      <p>ConversationRelay must be enabled on the account before a call can be
      connected to it. Access is not instant.</p>
    action:
      label: "ConversationRelay onboarding"
      href: "https://console.twilio.com/us1/develop/voice/conversation-relay"

  - kind: cli
    step: "CLI · ngrok"
    title: "Expose the backend"
    body: |
      <p>Twilio needs to reach the relay WebSocket (<code>wss://…/relay/ws</code>)
      and the inbound entry (<code>/voice/answer</code>). Set <code>PUBLIC_HOST</code>
      to the ngrok host, without the scheme.</p>
    code:
      sh: |
        ngrok http 8080

  - kind: webhook
    step: "Console · Voice webhook"
    title: "Point the number's Voice webhook at the entry route"
    body: |
      <p>When a call comes in, Twilio POSTs here and gets the ConversationRelay
      TwiML back.</p>
    action:
      paste: "https://<your-ngrok>/voice/answer"
      into: "Phone Number → Voice Configuration → A CALL COMES IN"

  - kind: code
    step: "Code · Inbound entry"
    title: "Hand the inbound call to ConversationRelay"
    when: "Twilio POSTs /voice/answer when a patient calls."
    uses:
      - { comp: conversationrelay, fn: "build_relay_twiml" }
    body: |
      <p>Handler route (<code>src/handlers/voice_agent</code>): builds the relay TwiML
      with the agent's own greeting. When <code>RELAY_ACTION_URL</code> is set it
      becomes the relay <code>action</code> URL, so a route there can take the call over
      when the agent ends the session. Unset, <code>action</code> is simply omitted.</p>
    ref: { piece: entry }

  - kind: code
    step: "Code · System prompt"
    title: "Persona, rules and guardrails"
    when: "Seeded into the conversation once per call."
    body: |
      <p><code>src/prompts/voice_agent</code> holds <code>SYSTEM_PROMPT</code>: the
      persona, the rule to answer only from the knowledge base, one question per turn,
      and the clinical guardrails.</p>
    ref: { piece: prompt }

  - kind: code
    step: "Code · Knowledge tool"
    title: "Answer general questions from the knowledge base (stub)"
    when: "The agent calls knowledge_lookup for hours, parking, location, insurance."
    body: |
      <p><code>src/tools/knowledge</code> matches the caller's words against the sample
      answers in <code>src/data/clinic_knowledge</code> and returns nothing when the
      question isn't covered, so the agent offers a person instead of guessing. Swap the
      lookup for real retrieval.</p>
    ref: { piece: knowledge }

  - kind: code
    step: "Code · Scheduling tools"
    title: "Check, book, reschedule and cancel (stub)"
    when: "The agent calls a scheduling tool once the caller has confirmed the details."
    body: |
      <p><code>src/tools/scheduling</code> works against the in-memory calendar in
      <code>src/data/calendar</code>, so the call is runnable before the real scheduling
      backend is wired in.</p>
    ref: { piece: scheduling }

  - kind: code
    step: "Code · Agent"
    title: "Run each turn through the OpenAI tool-use loop"
    when: "Each spoken turn arrives on /relay/ws as a prompt."
    uses:
      - { comp: conversationrelay, fn: "RelayHandler" }
      - { comp: conversationrelay, fn: "RelayToolCtx" }
    body: |
      <p>Each caller turn runs <code>run_turn</code> (the OpenAI tool-use loop in
      <code>src/llm/</code>) with <code>SYSTEM_PROMPT</code>, the tools above, and
      <code>SHARED_TOOLS</code> — the tools the selected add-ons supply, collected by the
      generated <code>src/tools/</code> index (empty when none are selected). The
      handler builds one <code>RelayToolCtx</code> per call and passes it to every tool,
      so an add-on's tool can speak or end the session (e.g. to hand the caller to a
      person); once a tool ends the session, no further turns are taken. The fill
      tailors the prompt and the tools; the loop itself is generator code.</p>
    ref: { piece: agent }

  - kind: verify
    step: "Verify · Answer a call"
    title: "Call the number and ask a question"
    body: |
      <p>Call the Twilio number. The agent greets you, then answers a knowledge
      question (try "what are your hours?") and offers appointment help. Ask for "a
      person": on its own the agent says it can't transfer and offers to take a
      message; with a hand-off add-on selected, it uses that add-on's tool.</p>
    code:
      sh: |
        # Tail the backend logs while you call; each turn logs a prompt + reply.
        # Confirm /voice/answer returned <Connect><ConversationRelay> TwiML.
```

### LLM-only guidance (prompt.md)

# Prompt overlay — ai-voice-agent

LLM-only guidance for filling this use case. Not shown in the UI.

- Start from the shipped files included in this prompt and adapt them — keep their
  routes, region structure and public names:
  `src/handlers/voice_agent.*` (entry route + agent), `src/prompts/voice_agent.*`
  (`SYSTEM_PROMPT`), `src/tools/knowledge.*`, `src/tools/scheduling.*`, and the
  sample data in `src/data/`.
- The agent is **already wired to the runtime loop**: `on_prompt` seeds `history` with
  `SYSTEM_PROMPT` and calls `run_turn(history, TOOLS, on_token, ctx)` with one
  `RelayToolCtx` per call. `TOOLS` is the agent's own tools plus `SHARED_TOOLS`
  (from the generated `src/tools/` index — the add-ons' tools); keep `SHARED_TOOLS`
  in the list and never import an add-on's tool module directly. Do **not** rewrite
  that loop or add your own LLM client.
  Tailor `SYSTEM_PROMPT` to the Instructions and shape each tool file's `TOOLS` list
  (descriptions, parameters, which functions are exposed).
- Keep each tool a thin wrapper over its function, and keep sample data in `src/data/`
  (clearly fake), so the SE can later point the tools at a real knowledge base and
  scheduling backend. Do not inline the data into the prompt or the loop.
- Encode the behavioural rules in `SYSTEM_PROMPT`: never answer a general question from
  your own knowledge (call `knowledge_lookup`; if it returns nothing, say so and offer a
  human); one question per turn; confirm before writing a booking.
- Guardrails are non-negotiable: never give medical advice/diagnosis/triage; verify
  identity (name + date of birth) before discussing an appointment.
- Hand-offs to a person come only from a tool in `SHARED_TOOLS`. Keep the system
  prompt conditional ("if one of your tools hands the caller to a person, use it;
  otherwise offer to take a message") so it never promises a transfer the app can't
  make, and don't write a hand-off tool here.
- Do not re-register ConversationRelay's `/relay/ws` or `/voice/inbound`; this use
  case's own inbound route is `/voice/answer`.

### Use-case source (adapt this — keep its routes and public names) — `src/data/calendar.ts`

```ts
/**
 * In-memory appointment calendar — sample data for the scheduling tools.
 *
 * Resets on restart. Replace with the real scheduling backend.
 */

/** The bookable times offered on any day. */
export const SLOT_TIMES = ['09:00', '10:30', '14:00', '15:30']

/** Booked slots: "<day> <time>" → caller name. */
export const BOOKINGS = new Map<string, string>()
```

### Use-case source (adapt this — keep its routes and public names) — `src/data/clinicKnowledge.ts`

```ts
/**
 * Clinic knowledge base — clearly fake sample answers for `knowledge_lookup`.
 *
 * Keys are matched loosely against the caller's words. Replace with a real retrieval
 * source (vector search, Twilio Enterprise Knowledge) when wiring a real backend.
 */

export const KNOWLEDGE_BASE: Record<string, string> = {
  hours: 'The clinic is open weekdays 8am to 6pm and Saturdays 9am to 1pm.',
  parking:
    'Free patient parking is in the garage on 2nd Street; bring your ticket to the front desk to validate.',
  location: "We're at 100 Main Street, Suite 200. The entrance is on the Elm Street side.",
  insurance: 'We accept most major insurance plans. Bring your card and a photo ID to your visit.',
}
```

### Use-case source (adapt this — keep its routes and public names) — `src/handlers/voiceAgent.ts`

```ts
/**
 * AI voice agent (inbound) — answer questions from a knowledge base, book
 * appointments, and hand off through any tool an add-on supplies.
 *
 * Flow:
 *   Twilio number's Voice webhook → POST /voice/answer
 *     → ConversationRelay TwiML (greeting + optional relay `action` URL)
 *     → caller speaks; each turn reaches VoiceAgent.onPrompt over /relay/ws
 *     → the agent resolves the turn with its tools (`src/tools/`)
 *
 * Routes (exported as `router`, listed in `src/handlers/` and mounted by app.ts):
 *   POST /voice/answer   → inbound entry: hand the call to ConversationRelay
 *
 * Each caller turn runs `runTurn` (the OpenAI tool-use loop in `src/llm/`), driven by
 * SYSTEM_PROMPT (`src/prompts/voiceAgent.ts`) and TOOLS — the agent's own tools plus
 * `SHARED_TOOLS`. Every tool gets a `RelayToolCtx` for the call, so a tool can speak
 * or end the relay session.
 */

import { Router } from 'express'

import { runTurn, type Message, type Tool } from '../llm/index.js'
import { SYSTEM_PROMPT } from '../prompts/voiceAgent.js'
import {
  RelayHandler,
  RelayReply,
  RelayToolCtx,
  buildRelayTwiml,
  registerRelayHandler,
  type RelayEvent,
  type Send,
} from '../relay/index.js'
import { SHARED_TOOLS } from '../tools/index.js'
import { TOOLS as KNOWLEDGE_TOOLS } from '../tools/knowledge.js'
import { TOOLS as SCHEDULING_TOOLS } from '../tools/scheduling.js'

export const router = Router()


const GREETING =
  'Thanks for calling. I can answer questions about the clinic, or book or change an appointment. How can I help?'

router.post('/voice/answer', (_req, res) => {
  // Inbound entry — point the number's Voice webhook here. Owns the TwiML so the
  // greeting is the agent's own. RELAY_ACTION_URL, when set, becomes the relay
  // `action` URL: Twilio requests it when the agent ends the session, so a route
  // there can take the call over (e.g. a transfer to a person).
  const twiml = buildRelayTwiml({
    welcomeGreeting: GREETING,
    action: process.env.RELAY_ACTION_URL || undefined,
  })
  res.type('text/xml').send(twiml)
})


/** The tools the agent may call each turn, in the `Tool` shape the runtime agent runs:
 * its own, plus `SHARED_TOOLS` — whatever the app's add-ons give the agent (e.g. a
 * hand-off to a person), collected by the generated `src/tools/` index. */
const TOOLS: Tool<RelayToolCtx>[] = [...KNOWLEDGE_TOOLS, ...SCHEDULING_TOOLS, ...SHARED_TOOLS]

/** The conversational agent: each caller turn runs the OpenAI tool-use loop in
 * `runTurn`. History persists for the whole call; once a tool ends the session
 * (`ctx.ended`), no further turns are taken. */
export class VoiceAgent extends RelayHandler {
  private history: Message[] = [{ role: 'system', content: SYSTEM_PROMPT }]
  private ctx?: RelayToolCtx

  async onPrompt(transcript: string, _event: RelayEvent, send: Send): Promise<void> {
    const ctx = (this.ctx ??= new RelayToolCtx(send, this.session))
    if (ctx.ended) return
    this.history.push({ role: 'user', content: transcript })
    await runTurn(
      this.history,
      TOOLS,
      (token, last) => send(RelayReply.text(token, { last })),
      ctx,
      () => ctx.ended,
    )
  }
}

registerRelayHandler(VoiceAgent)
```

### Use-case source (adapt this — keep its routes and public names) — `src/prompts/voiceAgent.ts`

```ts
/** The voice agent's system prompt: persona, rules and guardrails. */


export const SYSTEM_PROMPT = `You are the inbound AI voice assistant for a medical clinic.
Answer general questions using the knowledge_lookup tool — never guess; if it
returns nothing, say you don't have that information. Help callers book, reschedule,
or cancel appointments using the scheduling tools, one question at a time, confirming
before you commit.

You are not a clinician: never give medical advice, diagnoses, or triage. Verify the
caller's name and date of birth before discussing any appointment.

When the caller asks for a person, needs clinical judgement, or you cannot resolve
the request: if one of your tools hands the caller to a person, use it; otherwise say
you can't transfer the call and offer to take a message. Never promise a transfer
you have no tool for. Be warm, concise, and plain-spoken.`
```

### Use-case source (adapt this — keep its routes and public names) — `src/tools/knowledge.ts`

```ts
/** Knowledge-base answers for general questions (hours, parking, location, insurance). */

import { KNOWLEDGE_BASE } from '../data/clinicKnowledge.js'
import type { Tool } from '../llm/index.js'


/** A knowledge-base answer for the question, or undefined when it isn't covered — so
 * the agent says it doesn't know and offers a person, rather than guessing. */
export function knowledgeLookup(question: string): string | undefined {
  const text = question.toLowerCase()
  for (const [key, answer] of Object.entries(KNOWLEDGE_BASE)) {
    if (text.includes(key)) return answer
  }
  return undefined
}

export const TOOLS: Tool[] = [
  {
    name: 'knowledge_lookup',
    description:
      'Answer a general question (hours, parking, location, insurance) from the clinic knowledge base. Returns null when the question is not covered.',
    parameters: {
      type: 'object',
      properties: { question: { type: 'string', description: "The caller's question." } },
      required: ['question'],
    },
    run: ({ question }: { question: string }) => ({ answer: knowledgeLookup(question) ?? null }),
  },
]
```

### Use-case source (adapt this — keep its routes and public names) — `src/tools/scheduling.ts`

```ts
/** Appointment scheduling against the sample calendar (`src/data/calendar.ts`). */

import { BOOKINGS, SLOT_TIMES } from '../data/calendar.js'
import type { Tool } from '../llm/index.js'


/** Open slots for a day: the fixed slot times minus what's booked. */
export function checkAvailability(day: string): string[] {
  return SLOT_TIMES.map((time) => `${day} ${time}`).filter((s) => !BOOKINGS.has(s))
}

/** Reserve a slot; false if already taken. */
export function bookAppointment(slot: string, name: string): boolean {
  if (BOOKINGS.has(slot)) return false
  BOOKINGS.set(slot, name)
  return true
}

/** Move a booking to a new open slot. */
export function rescheduleAppointment(oldSlot: string, newSlot: string, name: string): boolean {
  if (BOOKINGS.has(newSlot) || !BOOKINGS.has(oldSlot)) return false
  BOOKINGS.delete(oldSlot)
  BOOKINGS.set(newSlot, name)
  return true
}

/** Release a booked slot. */
export function cancelAppointment(slot: string): boolean {
  return BOOKINGS.delete(slot)
}

export const TOOLS: Tool[] = [
  {
    name: 'check_availability',
    description: 'List open appointment slots for a given day (e.g. "Thursday").',
    parameters: {
      type: 'object',
      properties: { day: { type: 'string', description: 'Day to check, e.g. "Thursday".' } },
      required: ['day'],
    },
    run: ({ day }: { day: string }) => ({ slots: checkAvailability(day) }),
  },
  {
    name: 'book_appointment',
    description: 'Book an open slot for the caller. Confirm the details before calling this.',
    parameters: {
      type: 'object',
      properties: {
        slot: { type: 'string', description: 'Slot to book, e.g. "Thursday 10:30".' },
        name: { type: 'string', description: "The caller's name." },
      },
      required: ['slot', 'name'],
    },
    run: ({ slot, name }: { slot: string; name: string }) => ({ booked: bookAppointment(slot, name) }),
  },
  {
    name: 'reschedule_appointment',
    description: 'Move an existing booking to a new open slot.',
    parameters: {
      type: 'object',
      properties: {
        oldSlot: { type: 'string' },
        newSlot: { type: 'string' },
        name: { type: 'string' },
      },
      required: ['oldSlot', 'newSlot', 'name'],
    },
    run: ({ oldSlot, newSlot, name }: { oldSlot: string; newSlot: string; name: string }) => ({
      rescheduled: rescheduleAppointment(oldSlot, newSlot, name),
    }),
  },
  {
    name: 'cancel_appointment',
    description: 'Cancel an existing booking by its slot.',
    parameters: {
      type: 'object',
      properties: { slot: { type: 'string' } },
      required: ['slot'],
    },
    run: ({ slot }: { slot: string }) => ({ cancelled: cancelAppointment(slot) }),
  },
]
```

## Features

### Feature: Warm transfer to human (PSTN)

_Gives the voice agent a `transfer_to_human` tool. When the agent calls it, the caller is parked in a conference on hold, the office is dialed on a second leg and asked to accept, then the two are bridged. Declines, no-answer, and voicemail recover the caller.
_

Standalone feature shipping its own source (below), already emitted to `src/tools/warmTransfer.ts` — adapt it, keep its routes and public names. The steps below name the seam it exposes; call into it from the use case's handler at that point. Never register entry routes or redefine the persona, and never put use-case code in these files.

# Warm transfer to human (PSTN)

Hands a live caller off to a human over the PSTN with a **warm** introduction — the
office hears who's calling and why before the caller is connected, and the agent only
bridges them once the office accepts.

## The flow

1. **Agent requests a transfer.** The voice agent calls this feature's
   `transfer_to_human` tool, which ends the ConversationRelay session with
   `handoffData = {reasonCode: "warm-transfer", reason: "…"}`.
2. **Park the caller.** Twilio POSTs the relay `action` URL (`/transfer/action`). The
   handler returns `<Dial><Conference>` TwiML that puts the caller into a per-call
   conference on hold music (`startConferenceOnEnter=false`), and kicks off the office
   leg.
3. **Dial the office.** A second call leg is placed to `OFFICE_PHONE_NUMBER` with
   **Answering Machine Detection** on. When a human answers, the office-answer TwiML
   `<Say>`s the reason and `<Gather>`s a keypress — "press 1 to accept".
4. **Bridge.** On **1**, the office leg joins the caller's conference
   (`startConferenceOnEnter=true`), the conference un-holds, and the two are talking.
   The agent has already exited.
5. **Recover.** On decline, no-answer, or voicemail (AMD), the office leg is dropped
   and the caller's leg is redirected to `/transfer/recover`, which apologises and
   offers a callback or message.

## How it plugs in

- **`transfer_to_human(reason)`** — the tool this feature gives the agent. It is
  exported in the module's `TOOLS` and collected into `SHARED_TOOLS` by the generated
  `src/tools/` index; the scenario's agent runs `SHARED_TOOLS` alongside its own tools,
  so the scenario never imports this module and has the tool only when the feature is
  selected.
- **Needs from the scenario:** an inbound voice entry whose TwiML passes
  `action=RELAY_ACTION_URL`, and an agent that runs `SHARED_TOOLS` with a
  `RelayToolCtx`. Set `RELAY_ACTION_URL=<PUBLIC_HOST>/transfer/action`.
- **Components:** `channels` (outbound office leg + webhook security) and
  `conversationrelay` (`RelayToolCtx`, which the tool uses to end the session).
- **Env:** `OFFICE_PHONE_NUMBER` (E.164 number the warm transfer dials) and
  `RELAY_ACTION_URL`.

## Trade-off / variants

The reliable demo version confirms the office with a **DTMF `<Gather>`** ("press 1"),
so it works without any speech backend on the office leg. A fancier variant runs a
**second ConversationRelay leg** so the agent speaks the briefing to the office
conversationally and interprets a spoken yes/no — more moving parts, out of scope for
v1. The conference/bridge primitive here is reusable; if a second voice scenario needs
it, promote this module to a `warm-transfer` component and `ref` it from both.

#### Walkthrough (steps.yaml)

```yaml
intro: >
  Give a voice agent a `transfer_to_human` tool. When the agent calls it, the relay
  session ends, the caller is parked in a conference on hold, the office is dialed on a
  second leg and asked to accept with a keypress, then the two are bridged. Declines,
  no-answer, and voicemail recover the caller with an apology. The office leg is a
  shared Channels dispatch; the tool, the conference park, the bridge, and the recovery
  are this feature's own module.

steps:
  - kind: console
    step: "Console · Office number"
    title: "Set the office phone number"
    body: |
      <p>The warm transfer dials this number. Save the doctor's office line (E.164) as
      <code>OFFICE_PHONE_NUMBER</code>, and point the relay <code>action</code> URL at
      this feature by setting <code>RELAY_ACTION_URL</code> to
      <code>&lt;PUBLIC_HOST&gt;/transfer/action</code>.</p>
    action:
      label: "Verified caller IDs & numbers"
      href: "https://console.twilio.com/us1/develop/phone-numbers/manage/verified"

  - kind: code
    step: "Code · Transfer tool"
    title: "The tool the agent calls"
    when: "The caller asks for a person, or needs help the agent can't give."
    uses:
      - { comp: conversationrelay, fn: "RelayToolCtx" }
    body: |
      <p><code>transfer_to_human</code> ends the relay session with
      <code>reasonCode="warm-transfer"</code> and a one-line reason for the office.
      Twilio then requests the relay <code>action</code> URL
      (<code>RELAY_ACTION_URL</code>). The file exports it in <code>TOOLS</code>, and the
      generated <code>src/tools/</code> index adds it to <code>SHARED_TOOLS</code>, which
      the agent runs alongside its own tools — so the agent gets the tool only when this
      feature is selected.</p>
    ref: { piece: tool }

  - kind: code
    step: "Code · Park & dial"
    title: "Park the caller, dial the office"
    when: "The tool ends the relay session with reasonCode=\"warm-transfer\"; Twilio POSTs /transfer/action."
    uses:
      - { comp: channels, fn: "place_call" }
    body: |
      <p>The relay <code>action</code> handler returns <code>&lt;Dial&gt;&lt;Conference&gt;</code>
      that parks the caller on hold (<code>startConferenceOnEnter=false</code>), then
      <code>begin_transfer</code> places the office leg with Answering Machine
      Detection so voicemail is caught.</p>
    ref: { piece: action }

  - kind: code
    step: "Code · Confirm & bridge"
    title: "Office accepts, then bridge"
    when: "The office leg is answered."
    body: |
      <p>The office hears the reason and presses 1 to accept; the office leg then joins
      the caller's conference with <code>startConferenceOnEnter=true</code>, so the hold
      music stops and the two are connected. A machine/voicemail answer (via the AMD
      callback) routes to recovery instead.</p>
    ref: { piece: office }

  - kind: code
    step: "Code · Recover"
    title: "Decline, no-answer, or voicemail"
    when: "The office declines, doesn't answer, or a machine picks up."
    body: |
      <p>The office leg is hung up and the parked caller is redirected out of the
      conference to <code>/transfer/recover</code>, which apologises and offers a
      callback or a message (stubbed — wire to your queue / voicemail).</p>
    ref: { piece: recover }

  - kind: verify
    step: "Verify · Ask for a human"
    title: "Call in and ask for a person"
    body: |
      <p>Call the agent and say "connect me to the office." You should hear hold music,
      the office line should ring, and pressing 1 on the office phone should drop you
      both into the same call. Decline (or let it go to voicemail) and confirm you hear
      the apology/callback prompt instead.</p>
    code:
      sh: |
        # Watch the office leg being created and the conference participants:
        twilio api:core:conferences:list --status in-progress
```

#### LLM-only guidance (prompt.md)

# Prompt overlay — warm-transfer-handoff

LLM-only guidance for wiring this feature into the chosen use case. Not shown in the UI.

- This feature ships its own module (`src/tools/warm_transfer.*`, included in this
  prompt): the `transfer_to_human` tool and all the conference/bridge/recovery routes.
  **Adapt it, don't rewrite it** — keep its routes, region structure, and public names
  (`transfer_to_human` / `transferToHuman`, `TOOLS`, `begin_transfer`, the
  `/transfer/*` routes).
- The tool reaches the agent through `SHARED_TOOLS` (the generated `src/tools/`
  index). Do not import this module from the use case; make sure the use case's agent
  adds `SHARED_TOOLS` to its tool list and runs every tool with a `RelayToolCtx`.
- The tool only **ends the ConversationRelay session** with
  `handoffData = {reasonCode: "warm-transfer", reason: "<one line the office hears>"}`.
  Do not place the office call from the agent — `/transfer/action` does that when
  Twilio fires the relay `action` URL.
- Set `RELAY_ACTION_URL=<PUBLIC_HOST>/transfer/action`, and make sure the use case's
  inbound `build_relay_twiml` / `buildRelayTwiml` call passes `action=RELAY_ACTION_URL`.
- The system prompt may tell the agent when to offer a person; tailor the tool's
  `description` to the Instructions rather than naming the tool in the prompt.
- Keep the `reason` short and non-sensitive — it is spoken aloud to the office. No
  personal or health details beyond what the office needs to decide whether to take
  the call.
- Do not register an inbound entry route or a persona here — this is an add-on. The
  only Twilio call it owns beyond the shared Channels dispatch is the conference
  bridging, which no component covers.

#### Feature source (adapt this — keep its routes and public names) — `src/tools/warmTransfer.ts`

```ts
/**
 * Warm transfer to a human over the PSTN.
 *
 * Parks the caller in a per-call conference on hold, dials the office on a second
 * leg, confirms with a keypress, then bridges the two. Declines / no-answer /
 * voicemail fall back to the caller with an apology.
 *
 * Routes (exported as `router`, listed in `src/handlers/` and mounted by app.ts):
 *   POST /transfer/action         → ConversationRelay `action` URL: park + dial office
 *   POST /transfer/office-answer  → office answered: say reason, gather accept
 *   POST /transfer/office-gather  → office keypress: bridge (1) or recover
 *   POST /transfer/office-amd     → AMD callback: voicemail/machine → recover
 *   POST /transfer/recover        → caller leg: apologise and offer a callback
 *   POST /transfer/recover-choice → caller's callback/message choice
 *
 * Tool (exported in `TOOLS`, collected into `SHARED_TOOLS` by `src/tools/`):
 *   transfer_to_human(reason) → ends the ConversationRelay session with
 *     `handoffData = {reasonCode: "warm-transfer", reason}`; Twilio then POSTs the
 *     relay `action` URL (`/transfer/action`) and the routes above take over.
 *
 * The caller's own CallSid names the conference, so the office leg can be bridged
 * into the right room.
 *
 * Env: OFFICE_PHONE_NUMBER — the E.164 number this dials; RELAY_ACTION_URL — this
 * `/transfer/action` route's public URL, passed as the relay `action` URL.
 */

import { Router, type Request } from 'express'
import twilio from 'twilio'

import { publicUrl } from '../channels/index.js'
import type { Tool } from '../llm/index.js'
import type { RelayToolCtx } from '../relay/index.js'
import { getClient } from '../twilioClient.js'

export const router = Router()

// The handoff reason code `transferToHuman` sends and `/transfer/action` catches.
const HANDOFF_REASON_CODE = 'warm-transfer'
const OFFICE_FALLBACK_REASON = 'A caller is holding to speak with the office.'

// Per-transfer context keyed by conference name — set when the caller is parked, read
// by the office leg so the reason doesn't travel through query strings. In a
// multi-instance deployment this would be a shared store (Redis, the events DB).
const PENDING = new Map<string, { reason: string }>()

function conferenceName(callSid: string): string {
  return `warm-transfer-${callSid}`
}

function parseHandoff(raw: unknown): Record<string, string> {
  if (typeof raw !== 'string' || !raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}


const NO_TRANSFER_REPLY =
  "I'm sorry, I can't connect you right now, but I can take a message or help you another way."

/** End the relay session for a warm transfer; Twilio then POSTs `/transfer/action`.
 * With no RELAY_ACTION_URL nothing would catch the handoff, so the agent apologises
 * and stays on the line instead. */
export function transferToHuman({ reason }: { reason?: string }, ctx: RelayToolCtx) {
  if (!process.env.RELAY_ACTION_URL) {
    ctx.say(NO_TRANSFER_REPLY)
    return { transferred: false, reason: 'RELAY_ACTION_URL is not set' }
  }
  ctx.end({ reasonCode: HANDOFF_REASON_CODE, reason: reason || OFFICE_FALLBACK_REASON })
  return { transferred: true }
}

export const TOOLS: Tool<RelayToolCtx>[] = [
  {
    name: 'transfer_to_human',
    description:
      'Hand the caller to a person at the office. Call this when the caller asks for a human, or needs help you cannot give or are not allowed to give.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'One short, non-sensitive line the office hears before accepting the call.',
        },
      },
      required: ['reason'],
    },
    run: transferToHuman,
  },
]


router.post('/transfer/action', async (req, res) => {
  // ConversationRelay `action` URL — fired when the relay session ends. On a
  // warm-transfer handoff: park the caller and dial the office. Any other session
  // end (normal hang-up) just releases the call.
  const handoff = parseHandoff(req.body?.HandoffData)
  const callerSid = String(req.body?.CallSid ?? '')

  const response = new twilio.twiml.VoiceResponse()
  if (handoff.reasonCode !== HANDOFF_REASON_CODE) {
    response.hangup()
    res.type('text/xml').send(response.toString())
    return
  }

  const conference = conferenceName(callerSid)
  PENDING.set(conference, { reason: handoff.reason ?? OFFICE_FALLBACK_REASON })
  await beginTransfer(conference)

  // Park the caller: they wait on hold until the office joins and starts the room.
  // endConferenceOnExit=true so hang-up tears the room down.
  // https://www.twilio.com/docs/voice/twiml/conference
  response
    .dial()
    .conference(
      { startConferenceOnEnter: false, endConferenceOnExit: true, beep: 'false' },
      conference,
    )
  res.type('text/xml').send(response.toString())
})

export async function beginTransfer(conference: string): Promise<string> {
  // Place the office leg with Answering Machine Detection. The office leg runs
  // /transfer/office-answer when answered; AMD routes machines/voicemail to recovery.
  // https://www.twilio.com/docs/voice/answering-machine-detection
  const call = await getClient().calls.create({
    to: process.env.OFFICE_PHONE_NUMBER!,
    from: process.env.TWILIO_PHONE_NUMBER!,
    url: publicUrl(`/transfer/office-answer?conference=${conference}`),
    machineDetection: 'DetectMessageEnd',
    asyncAmd: 'true',
    asyncAmdStatusCallback: publicUrl(`/transfer/office-amd?conference=${conference}`),
  })
  return call.sid
}


router.post('/transfer/office-answer', (req, res) => {
  // Office leg answered — state the reason and gather a keypress to accept.
  const conference = String(req.query.conference ?? '')
  const reason = PENDING.get(conference)?.reason ?? OFFICE_FALLBACK_REASON

  const response = new twilio.twiml.VoiceResponse()
  const gather = response.gather({
    numDigits: 1,
    timeout: 10,
    action: publicUrl(`/transfer/office-gather?conference=${conference}`),
  })
  gather.say(`${reason} Press 1 to accept the call, or hang up to decline.`)
  // No input → fall through to a decline, which recovers the caller.
  response.redirect(publicUrl(`/transfer/office-gather?conference=${conference}&decline=1`))
  res.type('text/xml').send(response.toString())
})

router.post('/transfer/office-gather', async (req, res) => {
  // Office pressed a key — bridge into the caller's conference on 1, else decline.
  const conference = String(req.query.conference ?? '')
  const digit = String(req.body?.Digits ?? '')

  const response = new twilio.twiml.VoiceResponse()
  if (digit === '1') {
    // Join the caller's room and start it — hold music stops, the two are bridged.
    PENDING.delete(conference)
    response
      .dial()
      .conference(
        { startConferenceOnEnter: true, endConferenceOnExit: true, beep: 'false' },
        conference,
      )
  } else {
    await recoverCaller(conference)
    response.say('No problem — goodbye.')
    response.hangup()
  }
  res.type('text/xml').send(response.toString())
})

router.post('/transfer/office-amd', async (req, res) => {
  // AMD status callback — a machine/voicemail answered the office leg. Hang it up and
  // recover the caller.
  const conference = String(req.query.conference ?? '')
  const answeredBy = String(req.body?.AnsweredBy ?? '')
  const officeCallSid = String(req.body?.CallSid ?? '')
  if (answeredBy.startsWith('machine') || answeredBy === 'fax') {
    if (officeCallSid) await getClient().calls(officeCallSid).update({ status: 'completed' })
    await recoverCaller(conference)
  }
  res.type('text/xml').send('')
})


async function recoverCaller(conference: string): Promise<void> {
  // Redirect the parked caller's leg to the recovery TwiML. The caller is the only
  // remaining participant; redirecting them out of the conference ends the hold.
  PENDING.delete(conference)
  const participants = await getClient().conferences(conference).participants.list({ limit: 1 })
  for (const participant of participants) {
    await getClient()
      .calls(participant.callSid)
      .update({ url: publicUrl('/transfer/recover'), method: 'POST' })
  }
}

router.post('/transfer/recover', (_req, res) => {
  // Caller leg after a failed transfer — apologise and offer a callback or message.
  const response = new twilio.twiml.VoiceResponse()
  const gather = response.gather({ numDigits: 1, timeout: 8, action: publicUrl('/transfer/recover-choice') })
  gather.say(
    "I'm sorry — the office isn't available right now. " +
      'Press 1 to request a callback, or 2 to leave a message.',
  )
  response.say("I didn't catch that. Please call again later. Goodbye.")
  response.hangup()
  res.type('text/xml').send(response.toString())
})

router.post('/transfer/recover-choice', (req, res) => {
  // Record the caller's callback/message choice. Stubbed: acknowledge and hang up.
  // Wire this to your callback queue or voicemail (<Record>) backend.
  const digit = String(req.body?.Digits ?? '')
  const response = new twilio.twiml.VoiceResponse()
  if (digit === '1') {
    response.say("Thanks — we'll call you back as soon as the office is free. Goodbye.")
  } else if (digit === '2') {
    response.say('Please leave your message after the tone.')
    response.record({ maxLength: 120, playBeep: true })
  } else {
    response.say('No problem. Please call again later. Goodbye.')
  }
  response.hangup()
  res.type('text/xml').send(response.toString())
})
```

---

### Feature: Live wallboard · event stream

_Standalone wallboard app (its own port) that reads the backend's always-on events store over GET /events and renders calls + messages, refreshed on demand._

Standalone feature — write it into `src/tools/` (something the agent calls; the file exports `TOOLS`, which the generated index adds to `SHARED_TOOLS`) or `src/handlers/` (an endpoint Twilio calls), working with any use case. The steps below name the seam it exposes; call into it from the use case's handler at that point. Never register entry routes or redefine the persona, and never put use-case code in these files. Use a component function when one covers the call; make any other Twilio call here through `twilio_client`.

# Live wallboard · event stream

Tooling feature, not a Twilio integration. It visualises the always-on events
store (CLAUDE.md §6) so a workshop audience can watch the system work without
anyone tailing logs.

- **What it ships:** a **standalone React app** (its own `package.json`, its own
  port — `:5175` by default), emitted to the generated project's `wallboard/`
  folder from this feature's `app/` subtree. It is not a panel inside the demo
  UI, and it does not require the demo UI.
- **How it reads events:** over HTTP. The backend already exposes
  `GET /events?limit=` (always on — §6); the wallboard pings it with a
  **Refresh button** and renders the rows newest-first with a few summary tiles.
  Deliberately simple — no WebSocket, no auto-poll.
- **Needs from the use case:** nothing specific; it reads whatever events the
  app's code emits (the fill writes `emit_event(...)` calls per §6).
- **Components:** none.

#### Walkthrough (steps.yaml)

```yaml
intro: >
  A standalone events wallboard — its own small React app on port 5175,
  emitted to the generated project's wallboard/ folder. It reads the backend's
  always-on events store over HTTP (GET /events) and renders rows newest-first
  with summary tiles. No Twilio calls, no WebSocket: a Refresh button re-pings
  the endpoint. The app ships ready-made; nothing here needs the fill to write it.

steps:
  - kind: verify
    step: "Verify · Events endpoint"
    title: "The backend already serves the events it records"
    body: |
      <p>Observability is always on (CLAUDE.md §6): the backend creates the
      events table at startup and exposes <code>GET /events</code>. Confirm it
      responds before opening the wallboard.</p>
    code:
      sh: |
        curl 'http://localhost:8080/events?limit=50'
        # [] until the app has emitted something; then rows of
        # {id, ts, component, method, event_type, correlation_id, status, payload_json}

  - kind: cli
    step: "Run · Start the wallboard"
    title: "Launch the standalone wallboard app"
    body: |
      <p><code>run.sh</code> starts it automatically alongside the backend when
      this feature is selected. To run it on its own:</p>
    code:
      sh: |
        cd wallboard && npm install && npm run dev
        # Vite serves the wallboard on http://localhost:5175
        # (its /api is proxied to the backend's GET /events)

  - kind: verify
    step: "Verify · Watch events land"
    title: "Open the wallboard, trigger an interaction, Refresh"
    body: |
      <p>Open <code>http://localhost:5175</code>. Place a call or send a message,
      then click <strong>Refresh</strong> — the rows the app emitted
      (<code>relay.prompt</code>, <code>channels.sms.inbound</code>, …) appear
      newest-first, with tiles for total events, errors, and distinct
      interactions.</p>
```

#### LLM-only guidance (prompt.md)

The wallboard ships as a complete standalone app in the generated `wallboard/`
folder — do NOT write, rewrite, or add files to it. It reads the backend's
always-on events store over `GET /events` (CLAUDE.md §6); you don't build a
store, a route, or a WebSocket for it.

Your only job for this feature is the same as for every app: emit events from
the code you write (handlers, tools) via `emit_event(...)` at each Twilio call
site, per the Observability section above. The more call sites you instrument,
the more the wallboard has to show.

## Components in scope

### Component: Channels (`channels`)

_Twilio Voice / SMS entry points — outbound dial, SMS inbound, Voice status callback, webhook signature validation._

Docs: https://www.twilio.com/docs/voice/api/call-resource

Env keys contributed: `TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, PUBLIC_HOST`

Instrument these call sites — when you call one of these functions, wrap it with `emit_event(component="channels", method=…, event_type=…)` using the `method` and `event_type` verbatim:

- `place_call` → `channels.voice.outbound`
- `verify_signature` → `channels.verify`
- `dispatch_sms` → `channels.sms.inbound`
- `dispatch_call_completed` → `channels.voice.status`

# Channels

Twilio Voice / SMS entry points, outbound dispatch and webhook security. **Does not
own `POST /voice/inbound`** — that route belongs to whichever voice component handles
the call (e.g. ConversationRelay).

One package per variant, emitted to `src/channels/` (`__init__.py` / `index.ts` is
the public surface). It exports a `router` the generator mounts.

| Surface | Purpose |
|---|---|
| `place_call(to, twiml, status_callback=None)` | Outbound call from `TWILIO_PHONE_NUMBER`, running `twiml` when answered. Status callback defaults to `/voice/status`. Returns the CallSid. |
| `POST /sms/inbound` | Inbound SMS/MMS webhook. Routes to the handler registered via `register_sms_handler`. Returns the handler's `MessagingResponse` as TwiML, or empty `<Response/>`. |
| `POST /voice/status` | Voice **status callback**. Fans `CallStatus=completed` out to every callback registered via `on_call_completed`. |
| `verify_signature(url, params, header)` | HMAC-SHA1 validation of `X-Twilio-Signature` for form webhooks. Call this first in any webhook route other code adds. |
| `verify_json_signature(url, raw_body, header)` | Same, for webhooks that POST JSON (`bodySHA256`). |
| `voice_response()` / `messaging_response()` | TwiML builders (SDK: helper library; REST: hand-built XML with the same surface). |
| `register_sms_handler(fn)` | Decorator — handler receives the inbound params dict; returns a `MessagingResponse` (or `None` for an empty ack). |
| `on_call_completed(fn)` | Decorator — fires on `CallStatus=completed`. Receives `(call_sid, params)`. |
| `public_url(path)` | Absolute URL on `PUBLIC_HOST` — for signature checks and callback URLs. |

TypeScript uses the camelCase names (`placeCall`, `registerSmsHandler`, …).

## Pieces (`wiring_views`)

`outbound` (`place_call`), `status` (`POST /voice/status`), `sms` (`POST /sms/inbound`).

## Env vars

- `TWILIO_AUTH_TOKEN` — used by `verify_signature`.
- `TWILIO_PHONE_NUMBER` — caller id for `place_call`.
- `PUBLIC_HOST` — ngrok host (no scheme). Used for self-URLs (signatures, status callback).

## Signature validation (both modes)

Twilio signs the full request URL + concatenation of sorted POST params with
HMAC-SHA1 and the account's auth token. The signature arrives as
`X-Twilio-Signature`. Verify **before** acting on any webhook payload.

Docs: <https://www.twilio.com/docs/voice/api/call-resource> ·
<https://www.twilio.com/docs/usage/security>

## Using Channels

```python
from channels import on_call_completed, place_call, register_sms_handler, messaging_response

call_sid = place_call("+15551234567", twiml="<Response><Say>Hi</Say></Response>")

@register_sms_handler
async def reply_to_sms(params: dict) -> object:
    resp = messaging_response()
    resp.message("pong")
    return resp

@on_call_completed
async def after_call(call_sid: str, params: dict) -> None:
    ...
```

# Component: Channels (`channels`)

Channels owns outbound dispatch, `POST /sms/inbound` and `POST /voice/status`, plus
shared webhook helpers. **It does not own `POST /voice/inbound`** — that route
belongs to the selected voice component (e.g. `conversationrelay`).

**Imports (TypeScript)**

```ts
import {
  placeCall,
  onCallCompleted,
  registerSmsHandler,
  voiceResponse,
  messagingResponse,
  verifySignature,
  publicUrl,
} from "../channels/index.js";
```

**Functions**

- `placeCall(to: string, twiml: string, statusCallback?: string): Promise<string>` —
  dials `to` from `TWILIO_PHONE_NUMBER`, runs `twiml` on answer, resolves to the CallSid.
- `registerSmsHandler(fn)` — handler receives the inbound params object and
  returns a `MessagingResponse` (or `null`).
- `onCallCompleted(fn)` — fires on `CallStatus=completed`. Receives
  `(callSid: string, params: Record<string, string>)`.
- `messagingResponse()` / `voiceResponse()` — TwiML builders.
- `verifySignature(url, params, header)` — for webhook routes you add yourself.
- `publicUrl(path)` — absolute URL on `PUBLIC_HOST`.
**Do NOT**

- Re-register `POST /sms/inbound` or `POST /voice/status` — Channels owns them.
- Call `calls.create` yourself for a plain outbound call — use `place_call`.
- Skip signature validation when adding a new webhook route.

**Verify against the Twilio docs MCP** before relying on any payload field or
`CallStatus` value you don't see used here.

#### Package source (already emitted — import from it, do not rewrite it) — `src/channels/channels.ts`

```ts
/**
 * Channels — Twilio Voice / SMS entry points, outbound dispatch and webhook security.
 *
 * Public surface:
 *   placeCall(to, twiml, statusCallback?) -> Promise<string>   // outbound voice, returns CallSid
 *   verifySignature(url, params, header) -> boolean
 *   verifyJsonSignature(url, rawBody, header) -> boolean
 *   voiceResponse() / messagingResponse()                      // TwiML builders
 *   registerSmsHandler(fn)
 *   onCallCompleted(fn)
 *   publicUrl(path) -> string
 *
 * Routes (exported as `router`, mounted by app.ts):
 *   POST /sms/inbound   → the registered SMS handler
 *   POST /voice/status  → fans `completed` out to onCallCompleted callbacks
 *
 * `POST /voice/inbound` is not owned by Channels — it belongs to the voice component
 * in scope (e.g. ConversationRelay).
 *
 * Docs: https://www.twilio.com/docs/voice/api/call-resource ·
 * https://www.twilio.com/docs/usage/security
 */

import { Router, type Request } from 'express'
import twilio from 'twilio'

import { getClient } from '../twilioClient.js'

export type Params = Record<string, string>

export type SmsHandler = (
  params: Params,
) => twilio.twiml.MessagingResponse | null | Promise<twilio.twiml.MessagingResponse | null>

export type CallCompletedHandler = (callSid: string, params: Params) => void | Promise<void>

const STATUS_CALLBACK_PATH = '/voice/status'

let smsHandler: SmsHandler | null = null
const callCompletedHandlers: CallCompletedHandler[] = []


/**
 * Dial `to` from TWILIO_PHONE_NUMBER and run `twiml` when it is answered.
 *
 * `statusCallback` defaults to this app's `/voice/status`, so `onCallCompleted`
 * callbacks fire when the call ends. Resolves to the new CallSid.
 */
export async function placeCall(to: string, twiml: string, statusCallback?: string): Promise<string> {
  // Programmable Voice — create an outbound call.
  // https://www.twilio.com/docs/voice/api/call-resource#create-a-call-resource
  const call = await getClient().calls.create({
    to,
    from: process.env.TWILIO_PHONE_NUMBER!,
    twiml,
    statusCallback: statusCallback ?? publicUrl(STATUS_CALLBACK_PATH),
    statusCallbackEvent: ['completed'],
  })
  return call.sid
}


export function registerSmsHandler(fn: SmsHandler): SmsHandler {
  smsHandler = fn
  return fn
}

export function onCallCompleted(fn: CallCompletedHandler): CallCompletedHandler {
  callCompletedHandlers.push(fn)
  return fn
}

export function voiceResponse(): twilio.twiml.VoiceResponse {
  return new twilio.twiml.VoiceResponse()
}

export function messagingResponse(): twilio.twiml.MessagingResponse {
  return new twilio.twiml.MessagingResponse()
}

export function verifySignature(url: string, params: Params, signatureHeader: string | undefined): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken || !signatureHeader) {
    console.warn('channels: refusing webhook — missing TWILIO_AUTH_TOKEN or signature header')
    return false
  }
  return twilio.validateRequest(authToken, signatureHeader, url, params)
}

/**
 * Validate the `X-Twilio-Signature` of a webhook that POSTs a JSON body.
 *
 * For JSON webhooks Twilio appends a `bodySHA256` query parameter to the URL, so
 * `url` must be the full URL including that query string, and `rawBody` the
 * unparsed request body. https://www.twilio.com/docs/usage/webhooks/webhooks-security
 */
export function verifyJsonSignature(url: string, rawBody: string, signatureHeader: string | undefined): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken || !signatureHeader) {
    console.warn('channels: refusing webhook — missing TWILIO_AUTH_TOKEN or signature header')
    return false
  }
  return twilio.validateRequestWithBody(authToken, signatureHeader, url, rawBody)
}

export function publicUrl(path: string): string {
  let host = (process.env.PUBLIC_HOST ?? '').trim().replace(/\/+$/, '')
  if (host && !/^https?:\/\//i.test(host)) host = `https://${host}`
  return host ? `${host}${path}` : path
}

export async function dispatchSms(params: Params): Promise<twilio.twiml.MessagingResponse | null> {
  if (!smsHandler) {
    console.info('channels: inbound SMS received, no handler registered')
    return null
  }
  return (await smsHandler(params)) ?? null
}

export async function dispatchCallCompleted(callSid: string, params: Params): Promise<void> {
  for (const callback of callCompletedHandlers) {
    try {
      await callback(callSid, params)
    } catch (err) {
      console.error('channels: onCallCompleted callback failed', err)
    }
  }
}

/** The request's form params, or null when the Twilio signature doesn't match. */
function signedForm(req: Request, path: string): Params | null {
  const params = req.body as Params
  return verifySignature(publicUrl(path), params, req.header('X-Twilio-Signature') ?? undefined) ? params : null
}

export const router = Router()


router.post('/sms/inbound', async (req, res) => {
  // Twilio Messaging webhook — verifies the signature, hands off to the SMS handler.
  const params = signedForm(req, '/sms/inbound')
  if (!params) {
    res.status(403).type('text/plain').send('invalid signature')
    return
  }
  const reply = await dispatchSms(params)
  res.type('text/xml').send(reply ? reply.toString() : '<Response/>')
})


router.post(STATUS_CALLBACK_PATH, async (req, res) => {
  // Twilio Voice status callback — `placeCall` sets this URL automatically; for
  // inbound calls set the number's Status Callback URL to `<PUBLIC_HOST>/voice/status`.
  const params = signedForm(req, STATUS_CALLBACK_PATH)
  if (!params) {
    res.status(403).type('text/plain').send('invalid signature')
    return
  }
  if (params.CallStatus === 'completed') {
    await dispatchCallCompleted(params.CallSid ?? '', params)
  }
  res.status(204).end()
})
```

#### Package source (already emitted — import from it, do not rewrite it) — `src/channels/index.ts`

```ts
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
```

---

### Component: ConversationRelay (`conversationrelay`)

_TwiML <Connect><ConversationRelay> + a WebSocket handler that streams caller turns to an LLM._

Docs: https://www.twilio.com/docs/voice/twiml/connect/conversationrelay

Env keys contributed: `PUBLIC_HOST, TWILIO_PHONE_NUMBER, RELAY_VOICE, RELAY_LANGUAGE`

Instrument these call sites — when you call one of these functions, wrap it with `emit_event(component="conversationrelay", method=…, event_type=…)` using the `method` and `event_type` verbatim:

- `build_relay_twiml` → `relay.twiml`
- `on_prompt` → `relay.prompt`
- `on_dtmf` → `relay.dtmf`
- `on_interrupt` → `relay.interrupt`
- `on_error` → `relay.error`

# ConversationRelay component

Twilio ConversationRelay hands a phone call to your app over a persistent
WebSocket. Twilio does speech-to-text and text-to-speech; your app sees each caller
turn as text and sends text back.

Docs: <https://www.twilio.com/docs/voice/twiml/connect/conversationrelay>
Prereq: **Onboarding required** — Console > Voice > ConversationRelay > Onboarding.

## What this component ships

One package per variant, emitted to `src/relay/` (`__init__.py` / `index.ts` is the
public surface):

- `build_relay_twiml(...)` / `buildRelayTwiml(...)` — TwiML for `<Connect><ConversationRelay/>`
  pointed at `wss://<PUBLIC_HOST>/relay/ws`.
- `RelayHandler` — dispatches Twilio's frames to hooks: `on_setup`, `on_prompt`,
  `on_interrupt`, `on_dtmf`, `on_error`, `on_close` (camelCase in TS).
- `RelayReply` — frames sent back to Twilio: `text(token, last=True)`,
  `end(handoff_data=None)`, `language(tts, transcription=None)`.
- `register_relay_handler(cls)` / `registerRelayHandler(cls)` — the `RelayHandler`
  subclass `/relay/ws` instantiates per call.
- `router`:
  - `POST /voice/inbound` — TwiML for inbound calls.
  - `WS /relay/ws` — Python serves it on the router; TypeScript attaches it to the
    `http.Server` via `attachRelayWebSocket(server)` (spliced by `server_hooks.ts`).
- Demo-UI panels: **Live transcript**, **Relay events**.

## Pieces (`wiring_views`)

`twiml` (`build_relay_twiml`), `handler` (`RelayHandler`), `ws` (the WebSocket endpoint).

## Env vars added

- `PUBLIC_HOST` — ngrok / production host **without scheme or trailing slash**.
- `TWILIO_PHONE_NUMBER` — the E.164 number whose Voice webhook points at `/voice/inbound`.
- `RELAY_VOICE` — optional TTS voice.
- `RELAY_LANGUAGE` — optional locale (e.g. `en-US`).

## Using it

```python
from relay import RelayHandler, RelayReply, register_relay_handler

@register_relay_handler
class MyAgent(RelayHandler):
    async def on_prompt(self, transcript, event, send):
        await send(RelayReply.text(f"You said: {transcript}"))
```

For an outbound call, pass `build_relay_twiml(...)` as the `twiml` of
`channels.place_call` — no extra webhook needed.

# Component: ConversationRelay (`conversationrelay`)

ConversationRelay owns `POST /voice/inbound` and the `/relay/ws` WebSocket. Twilio
does speech-to-text and text-to-speech; your code receives caller turns as text and
replies with text frames.

**Imports (TypeScript)**

```ts
import {
  RelayHandler,
  RelayReply,
  buildRelayTwiml,
  registerRelayHandler,
  RelayToolCtx,
  type RelayEvent,
  type Send,
} from "../relay/index.js";
```

**Functions and classes**

- `buildRelayTwiml({ welcomeGreeting, voice, language, intelligenceService, hints, action, ... }): string`
  — TwiML connecting the call to `/relay/ws`. Pass it as `twiml` to `placeCall`
  for outbound calls. `action` is a URL Twilio POSTs when the relay session ends
  (hang-up or `RelayReply.end(handoffData)`) — use it to continue the call, e.g. a
  warm transfer that parks the caller in a conference.
- `RelayHandler` — subclass and override `onSetup(event, send)`,
  `onPrompt(transcript, event, send)`, `onInterrupt(event, send)`,
  `onDtmf(digit, event, send)`, `onError(description, event, send)`, `onClose()`.
  `this.session.callSid` is set after `setup`. `send` is `(frame: string) => void`.
- `RelayReply.text(token, { last })`, `RelayReply.end(handoffData?)`,
  `RelayReply.language(ttsLanguage, transcriptionLanguage?)` — frames for `send`.
- `registerRelayHandler(MyAgent)` — call once so `/relay/ws` uses your subclass.
- `new RelayToolCtx(send, session)` — the per-call `ctx` to pass to agent tools:
  `say(text)`, `end(handoffData)` (ends the session and sets `ended`), `session.callSid`.
**Do NOT**

- Re-register `POST /voice/inbound` or the `/relay/ws` WebSocket — the component owns them.
- Hard-code an LLM inside the component — the LLM call belongs in your handler subclass.
- Hand-build `<ConversationRelay>` TwiML — use `build_relay_twiml`.

**Verify against the Twilio docs MCP** before using a ConversationRelay attribute or
WebSocket message field you don't see used here.

#### Package source (already emitted — import from it, do not rewrite it) — `src/relay/conversationRelay.ts`

```ts
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
```

#### Package source (already emitted — import from it, do not rewrite it) — `src/relay/index.ts`

```ts
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
```

---

Produce the JSON object now.

