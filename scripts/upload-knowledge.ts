/**
 * Upload a document to the Enterprise Knowledge base in TWILIO_KNOWLEDGE_BASE_ID, then
 * run a few test searches against it.
 *
 *   npm run upload-knowledge                                   # dry run
 *   npm run upload-knowledge -- --apply                        # upload the sample FAQ
 *   npm run upload-knowledge -- --apply --file path/to/doc.md  # any .md/.txt/.pdf/.csv
 *
 * Flow (all writes are async): create a File knowledge source → PUT the file to the
 * presigned `importUrl` (no auth header: it's already signed) → poll the source until
 * COMPLETED → search. A knowledge base holds at most 10 sources; if one with the same
 * name exists, its id is printed and nothing is uploaded (delete it first to replace it).
 *
 * Docs: https://www.twilio.com/docs/conversations/knowledge (API: knowledge.twilio.com/v2)
 */

import 'dotenv/config'
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

const BASE = 'https://knowledge.twilio.com/v2'
const DEFAULT_FILE = 'docs/knowledge/acme-health-faq.md'
const SOURCE_NAME = 'acme-health-faq' // max 30 characters
const MAX_BYTES = 16 * 1024 * 1024

const MIME: Record<string, string> = {
  '.md': 'text/markdown',
  '.mdx': 'text/mdx',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
}

const TEST_QUERIES = [
  'Where do I park?',
  'What happens if I cancel my appointment late?',
  'Do you take Medicare?',
  'Can I get a flu shot without an appointment?',
]

const args = process.argv.slice(2)
const apply = args.includes('--apply')
const file = args[args.indexOf('--file') + 1] && args.includes('--file') ? args[args.indexOf('--file') + 1] : DEFAULT_FILE

function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`missing environment variable: ${name}`)
  return value
}

const kbId = required('TWILIO_KNOWLEDGE_BASE_ID')
const [user, pass] =
  process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET
    ? [process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET]
    : [required('TWILIO_ACCOUNT_SID'), required('TWILIO_AUTH_TOKEN')]
const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`
const headers = { Authorization: auth, 'Content-Type': 'application/json' }

async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${text}`)
  return (text ? JSON.parse(text) : {}) as T
}

const mimeType = MIME[extname(file).toLowerCase()]
if (!mimeType) throw new Error(`unsupported file type ${extname(file)} — use ${Object.keys(MIME).join(', ')}`)
const { size } = await stat(file)
if (size > MAX_BYTES) throw new Error(`${file} is ${size} bytes; the limit is ${MAX_BYTES}`)

const kb = await api('GET', `/ControlPlane/KnowledgeBases/${kbId}`)
const existing = (await api<{ knowledge?: Array<{ id: string; name: string; status: string }> }>('GET', `/KnowledgeBases/${kbId}/Knowledge`))
  .knowledge ?? []

console.log(`knowledge base: ${kb.displayName ?? kbId} (${kb.status ?? 'unknown status'}), ${existing.length}/10 sources`)
for (const k of existing) console.log(`  · ${k.name} — ${k.status} (${k.id})`)
console.log(`file: ${file} (${size} bytes, ${mimeType}) → source "${SOURCE_NAME}"`)

const already = existing.find((k) => k.name === SOURCE_NAME)
if (already) {
  console.log(`\nA source named "${SOURCE_NAME}" already exists (${already.id}, ${already.status}) — nothing uploaded.`)
} else if (!apply) {
  console.log('\ndry run — re-run with --apply to upload')
  process.exit(0)
} else {
  if (existing.length >= 10) throw new Error('this knowledge base already has 10 sources (the maximum)')

  // 1. Create the File source; the response carries a presigned upload URL.
  const created = await api('POST', `/KnowledgeBases/${kbId}/Knowledge`, {
    name: SOURCE_NAME,
    description: 'Acme Health clinic FAQ: hours, location, parking, appointments, insurance, billing, prescriptions, services and urgent care.',
    source: { type: 'File', fileName: basename(file), fileSize: size, mimeType },
  })
  const importUrl: string | undefined = created.source?.importUrl
  if (!importUrl) throw new Error(`no importUrl in response: ${JSON.stringify(created)}`)
  console.log(`\ncreated source ${created.id} (${created.status})`)

  // 2. Upload the bytes. No Authorization header — the URL is already signed.
  const put = await fetch(importUrl, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: await readFile(file) })
  if (!put.ok) throw new Error(`upload failed: HTTP ${put.status} ${await put.text()}`)
  console.log('uploaded file')

  // 3. Wait for processing.
  for (let attempt = 0; ; attempt++) {
    await new Promise((r) => setTimeout(r, 3000))
    const k = await api('GET', `/KnowledgeBases/${kbId}/Knowledge/${created.id}`)
    process.stdout.write(`  status: ${k.status}\n`)
    if (k.status === 'COMPLETED') break
    if (k.status === 'FAILED') throw new Error(`processing failed: ${JSON.stringify(k)}`)
    if (attempt > 60) throw new Error('still processing after 3 minutes — check the Console')
  }
}

// 4. Show that it's searchable.
console.log('\ntest searches:')
for (const query of TEST_QUERIES) {
  const { chunks = [] } = await api<{ chunks?: Array<{ content: string; score?: number }> }>('POST', `/KnowledgeBases/${kbId}/Search`, {
    query,
    top: 1,
  })
  const top = chunks[0]
  console.log(`  "${query}"`)
  console.log(top ? `    → [${top.score?.toFixed(3) ?? '?'}] ${top.content.replace(/\s+/g, ' ').slice(0, 140)}…` : '    → no results')
}
