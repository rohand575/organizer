/**
 * Intent understanding + dictation polish. Sends transcripts to an LLM
 * (Groq Llama primary, OpenAI GPT fallback) and returns either structured
 * actions (command mode) or cleaned-up prose (note dictation).
 */
import { fetchWithTimeout, VoiceError } from './stt'

const GROQ_KEY = import.meta.env.VITE_GROQ_API_KEY
const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY

type Provider = 'groq' | 'openai'
const KEYS: Record<Provider, string | undefined> = { groq: GROQ_KEY, openai: OPENAI_KEY }

export type Section = 'todos' | 'lists' | 'notes'

export type Action =
  | { type: 'add_todo'; text: string; remindAt?: string }
  | { type: 'add_list_items'; list: string; items: string[] }
  | { type: 'add_note'; title: string; body: string }
  | { type: 'unknown'; reason?: string }

export interface IntentContext {
  transcript: string
  section: Section
  listTitles: string[]
  nowISO: string
  timeZone: string
}

interface Message {
  role: 'system' | 'user'
  content: string
}

async function chatWith(
  provider: Provider,
  messages: Message[],
  opts: { json: boolean; maxTokens: number },
): Promise<string> {
  const key = KEYS[provider]
  if (!key) throw new VoiceError(`${provider} key missing`, 'no-key')

  const url =
    provider === 'groq'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions'
  const model = provider === 'groq' ? 'llama-3.3-70b-versatile' : 'gpt-4o-mini'

  let res: Response
  try {
    res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          temperature: opts.json ? 0.1 : 0.2,
          max_tokens: opts.maxTokens,
          ...(opts.json ? { response_format: { type: 'json_object' } } : {}),
          messages,
        }),
      },
      20_000,
    )
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    throw new VoiceError(
      aborted ? `${provider} timed out` : `Network error reaching ${provider}: ${(e as Error).message}`,
      'network',
    )
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403)
      throw new VoiceError(`Invalid ${provider} API key`, 'auth')
    throw new VoiceError(`${provider} request failed (${res.status})`, 'provider')
  }
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> }
  return (json.choices?.[0]?.message?.content ?? '').trim()
}

async function chat(messages: Message[], opts: { json: boolean; maxTokens: number }): Promise<string> {
  const order = (['groq', 'openai'] as Provider[]).filter((p) => KEYS[p])
  let lastErr: VoiceError | null = null
  for (const provider of order) {
    try {
      const out = await chatWith(provider, messages, opts)
      if (out) return out
    } catch (e) {
      lastErr = e instanceof VoiceError ? e : new VoiceError(String(e), 'provider')
    }
  }
  throw lastErr ?? new VoiceError('No language model provider configured.', 'no-key')
}

// --- Command mode -----------------------------------------------------------

const SYSTEM = `You convert a person's spoken words into structured actions for a personal organizer app.
The app has three sections:
- "todos": a flat task checklist. Each task is one short item, and a task may have a reminder date/time.
- "lists": multiple named lists (e.g. Groceries, Packing), each holding checkable items.
- "notes": free-form notes with a title and body.

You are given the section the user is currently viewing, the names of their existing lists, and the current local date/time.

Return ONLY a JSON object of this exact shape:
{ "actions": [ ...one or more action objects... ] }

Action objects (use the "type" field):
- { "type": "add_todo", "text": "...", "remindAt": "YYYY-MM-DDTHH:MM:SS" }  — one per distinct task. "remindAt" is OPTIONAL: include it only when the user states a date and/or time. Resolve relative expressions ("tomorrow", "next Friday", "in 2 hours", "tonight") against the current local date/time you are given, and output a local wall-clock timestamp with no timezone suffix. If only a date is given, pick a sensible time; if only a time is given, use the nearest upcoming occurrence.
- { "type": "add_list_items", "list": "<list name>", "items": ["...", "..."] }
- { "type": "add_note", "title": "<short title>", "body": "<full content>" }
- { "type": "unknown", "reason": "<why>" }  — if nothing is actionable.

Rules:
- Route by what the user explicitly says. A named target ("add X to my groceries list") wins over the current section.
- With no explicit target, default to the CURRENT section.
- Match a list target to an existing list name when close (case-insensitive, ignore the word "list"); otherwise use the spoken name (the app will create it).
- Split distinct tasks/items into separate entries. "writing today and then the gym" -> two todos.
- Clean up filler words and self-corrections; capitalize naturally; keep items concise.
- Never invent content the user didn't say.
- Output JSON only. No prose, no markdown fences.`

function parseActions(raw: string): Action[] {
  let text = raw.trim().replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return [{ type: 'unknown', reason: "Couldn't understand that." }]
  }
  const arr = (parsed as { actions?: unknown }).actions
  if (!Array.isArray(arr)) return [{ type: 'unknown', reason: "Couldn't understand that." }]

  const actions: Action[] = []
  for (const a of arr) {
    if (!a || typeof a !== 'object') continue
    const o = a as Record<string, unknown>
    switch (o.type) {
      case 'add_todo':
        if (typeof o.text === 'string' && o.text.trim()) {
          const remindAt =
            typeof o.remindAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(o.remindAt)
              ? o.remindAt
              : undefined
          actions.push({ type: 'add_todo', text: o.text.trim(), remindAt })
        }
        break
      case 'add_list_items': {
        const items = Array.isArray(o.items)
          ? o.items.filter((x): x is string => typeof x === 'string' && x.trim().length > 0).map((x) => x.trim())
          : []
        if (typeof o.list === 'string' && o.list.trim() && items.length)
          actions.push({ type: 'add_list_items', list: o.list.trim(), items })
        break
      }
      case 'add_note':
        actions.push({
          type: 'add_note',
          title: typeof o.title === 'string' ? o.title.trim() : '',
          body: typeof o.body === 'string' ? o.body.trim() : '',
        })
        break
      case 'unknown':
        actions.push({ type: 'unknown', reason: typeof o.reason === 'string' ? o.reason : undefined })
        break
    }
  }
  return actions.length ? actions : [{ type: 'unknown', reason: "Couldn't understand that." }]
}

export async function interpret(ctx: IntentContext): Promise<Action[]> {
  const user = [
    `Current section: ${ctx.section}`,
    `Current local date/time: ${ctx.nowISO} (timezone ${ctx.timeZone})`,
    `Existing lists: ${ctx.listTitles.length ? ctx.listTitles.join(', ') : '(none yet)'}`,
    '',
    'The user said:',
    '"""',
    ctx.transcript,
    '"""',
  ].join('\n')
  const out = await chat(
    [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: user },
    ],
    { json: true, maxTokens: 800 },
  )
  return parseActions(out)
}

// --- Dictation polish -------------------------------------------------------

const POLISH_SYSTEM = `You clean up a raw speech-to-text transcript into polished written text for a personal note.
- Fix punctuation, capitalization, and obvious transcription slips.
- Remove filler words ("um", "uh", false starts) and apply spoken self-corrections ("at 2pm... actually 3pm" -> "at 3pm").
- Keep the speaker's words, meaning, and tone. Do NOT answer questions, add content, or summarize.
- Format naturally: sentences, and bullet/numbered lists when the speaker is clearly listing.
- Return ONLY the cleaned text — no preamble, no quotes, no markdown fences.`

/** Polish a raw dictation transcript. Falls back to the raw text on any error. */
export async function polishDictation(raw: string): Promise<string> {
  const trimmed = raw.trim()
  if (!trimmed) return trimmed
  try {
    const out = await chat(
      [
        { role: 'system', content: POLISH_SYSTEM },
        { role: 'user', content: trimmed },
      ],
      { json: false, maxTokens: Math.min(2000, Math.max(200, Math.ceil(trimmed.length))) },
    )
    let t = out.replace(/^```[a-z]*\n?/i, '').replace(/```$/i, '').trim()
    if (t.length > 2 && ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith('“') && t.endsWith('”'))))
      t = t.slice(1, -1).trim()
    return t || trimmed
  } catch {
    return trimmed
  }
}
