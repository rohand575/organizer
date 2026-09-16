/**
 * Google Calendar via Google Identity Services (GIS) token client. Runs fully
 * in the browser: request an access token for the calendar.events scope, cache
 * it (with expiry), refresh it silently, and call the Calendar REST API.
 *
 * Requires VITE_GOOGLE_CLIENT_ID (an OAuth Web client ID) and the Google
 * Calendar API enabled on that project.
 */

import { fetchWithTimeout } from './stt'

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID
const SCOPE = 'https://www.googleapis.com/auth/calendar.events'
const GIS_SRC = 'https://accounts.google.com/gsi/client'
const CONNECTED_KEY = 'gcal_connected'

/** Whether the feature is even available (client id configured). */
export const calendarConfigured = Boolean(CLIENT_ID)

// --- Minimal GIS typings (the script attaches these to window.google) ---
interface TokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: '' | 'consent' | 'none' }) => void
  callback: (resp: TokenResponse) => void
}
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (config: {
            client_id: string
            scope: string
            callback: (resp: TokenResponse) => void
          }) => TokenClient
          revoke: (token: string, done?: () => void) => void
        }
      }
    }
  }
}

let scriptPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (scriptPromise) return scriptPromise
  scriptPromise = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = GIS_SRC
    s.async = true
    s.defer = true
    s.onload = () => resolve()
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'))
    document.head.appendChild(s)
  })
  return scriptPromise
}

let tokenClient: TokenClient | null = null
let accessToken: string | null = null
let tokenExpiresAt = 0

async function ensureClient(): Promise<TokenClient> {
  if (!CLIENT_ID) throw new Error('Google client ID not configured')
  await loadGis()
  if (!tokenClient) {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: () => {}, // set per-request below
    })
  }
  return tokenClient
}

/** Request a token. prompt='consent' forces the account/consent popup. */
function requestToken(prompt: '' | 'consent'): Promise<string> {
  return new Promise((resolve, reject) => {
    ensureClient()
      .then((client) => {
        client.callback = (resp) => {
          if (resp.error || !resp.access_token) {
            reject(new Error(resp.error || 'Authorization failed'))
            return
          }
          accessToken = resp.access_token
          tokenExpiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000
          resolve(resp.access_token)
        }
        client.requestAccessToken({ prompt })
      })
      .catch(reject)
  })
}

export function isCalendarConnected(): boolean {
  return calendarConfigured && localStorage.getItem(CONNECTED_KEY) === '1'
}

/** Interactive connect — shows the Google consent popup. */
export async function connectCalendar(): Promise<void> {
  await requestToken('consent')
  localStorage.setItem(CONNECTED_KEY, '1')
}

export function disconnectCalendar(): void {
  const token = accessToken
  accessToken = null
  tokenExpiresAt = 0
  localStorage.removeItem(CONNECTED_KEY)
  if (token) window.google?.accounts.oauth2.revoke(token)
}

/** Valid cached token, or a silent refresh; null if not connected/consented. */
async function getAccessToken(): Promise<string | null> {
  if (!isCalendarConnected()) return null
  if (accessToken && Date.now() < tokenExpiresAt - 60_000) return accessToken
  try {
    return await requestToken('')
  } catch {
    return null
  }
}

export interface CalendarEventInput {
  summary: string
  startISO: string // local ISO, e.g. 2026-09-16T18:30:00
  durationMin: number
  timeZone: string
  colorId?: string // '1'..'11'
}

function addMinutesISO(startISO: string, minutes: number): string {
  const d = new Date(startISO)
  d.setMinutes(d.getMinutes() + minutes)
  // Preserve local wall-clock formatting without the trailing Z.
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`
}

/** Create a Calendar event. Returns the event id, or null if not connected. */
export async function createEvent(input: CalendarEventInput): Promise<string | null> {
  const token = await getAccessToken()
  if (!token) return null
  const endISO = addMinutesISO(input.startISO, input.durationMin)
  const body = {
    summary: input.summary,
    start: { dateTime: input.startISO, timeZone: input.timeZone },
    end: { dateTime: endISO, timeZone: input.timeZone },
    ...(input.colorId ? { colorId: input.colorId } : {}),
  }
  const res = await fetchWithTimeout(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    15_000,
  )
  if (!res.ok) throw new Error(`Calendar create failed (${res.status})`)
  const json = (await res.json()) as { id?: string }
  return json.id ?? null
}

export async function deleteEvent(eventId: string): Promise<void> {
  const token = await getAccessToken()
  if (!token) return
  await fetchWithTimeout(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
    15_000,
  )
}

/** Update an existing event's summary/start (returns false if not connected). */
export async function updateEvent(eventId: string, input: CalendarEventInput): Promise<boolean> {
  const token = await getAccessToken()
  if (!token) return false
  const endISO = addMinutesISO(input.startISO, input.durationMin)
  const body = {
    summary: input.summary,
    start: { dateTime: input.startISO, timeZone: input.timeZone },
    end: { dateTime: endISO, timeZone: input.timeZone },
    ...(input.colorId ? { colorId: input.colorId } : {}),
  }
  const res = await fetchWithTimeout(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    15_000,
  )
  return res.ok
}
