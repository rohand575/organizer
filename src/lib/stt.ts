/**
 * Browser speech-to-text. Ported from the Cadence desktop app: Groq Whisper
 * (fast) primary, OpenAI Whisper fallback — whichever keys are present. Runs
 * entirely client-side; keys come from Vite env at build time.
 */

const GROQ_KEY = import.meta.env.VITE_GROQ_API_KEY
const OPENAI_KEY = import.meta.env.VITE_OPENAI_API_KEY

/** True when at least one provider key is configured — gates the whole feature. */
export const hasVoiceKeys = Boolean(GROQ_KEY || OPENAI_KEY)

type Provider = 'groq' | 'openai'

export class VoiceError extends Error {
  constructor(
    message: string,
    public readonly kind: 'no-key' | 'auth' | 'network' | 'provider' | 'mic' | 'empty',
  ) {
    super(message)
  }
}

const KEYS: Record<Provider, string | undefined> = { groq: GROQ_KEY, openai: OPENAI_KEY }

/**
 * fetch with a guaranteed timeout via AbortController. We don't use
 * AbortSignal.timeout() because it isn't reliable across older iOS Safari.
 */
export async function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    // Race the fetch against an independent rejecting timer. On some WebKit
    // (standalone PWA) contexts, abort() doesn't always settle the fetch, so we
    // don't rely on it alone.
    return await Promise.race([
      fetch(url, { ...init, signal: controller.signal }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new DOMException('Request timed out', 'AbortError')), ms + 500),
      ),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/** Groq first (fast, free tier), then OpenAI — only providers with a key. */
function providerOrder(): Provider[] {
  return (['groq', 'openai'] as Provider[]).filter((p) => KEYS[p])
}

function extFor(mime: string): string {
  if (mime.includes('mp4') || mime.includes('m4a')) return 'm4a'
  if (mime.includes('ogg')) return 'ogg'
  if (mime.includes('wav')) return 'wav'
  return 'webm'
}

async function transcribeWith(provider: Provider, blob: Blob): Promise<string> {
  const key = KEYS[provider]
  if (!key) throw new VoiceError(`${provider} API key missing`, 'no-key')

  const url =
    provider === 'groq'
      ? 'https://api.groq.com/openai/v1/audio/transcriptions'
      : 'https://api.openai.com/v1/audio/transcriptions'
  const model = provider === 'groq' ? 'whisper-large-v3-turbo' : 'whisper-1'

  const form = new FormData()
  form.append('file', blob, `audio.${extFor(blob.type)}`)
  form.append('model', model)
  form.append('response_format', 'json')
  form.append('temperature', '0')

  let res: Response
  try {
    res = await fetchWithTimeout(
      url,
      { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form },
      30_000,
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
    throw new VoiceError(`${provider} transcription failed (${res.status})`, 'provider')
  }

  const json = (await res.json()) as { text?: string }
  return (json.text ?? '').trim()
}

/** Transcribe recorded audio, trying each configured provider in turn. */
export async function transcribe(blob: Blob): Promise<string> {
  const order = providerOrder()
  if (order.length === 0)
    throw new VoiceError('No transcription provider configured.', 'no-key')

  let lastErr: VoiceError | null = null
  for (const provider of order) {
    try {
      return await transcribeWith(provider, blob)
    } catch (e) {
      lastErr = e instanceof VoiceError ? e : new VoiceError(String(e), 'provider')
      if (lastErr.kind === 'no-key') continue
      // fall through to next provider on any real failure
    }
  }
  throw lastErr ?? new VoiceError('Transcription failed.', 'provider')
}
