import { useCallback, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '../auth/AuthProvider'
import { hasVoiceKeys, transcribe, VoiceError } from '../lib/stt'
import { interpret, type Section } from '../lib/intent'
import { executeActions, loadLists } from '../lib/commands'
import { useHoldToTalk } from '../lib/useHoldToTalk'
import { MicIcon } from './icons'

type Phase = 'idle' | 'working' | 'done' | 'error'

const SECTION_BY_PATH: Record<string, Section> = {
  '/tasks': 'todos',
  '/lists': 'lists',
  '/notes': 'notes',
}

// The floating mic only appears where command mode makes sense.
const FAB_PATHS = new Set(['/tasks', '/lists'])

function localNowISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}:${pad(d.getSeconds())}`
}

function errorMessage(e: unknown): string {
  if (e instanceof VoiceError) {
    if (e.kind === 'auth') return 'API key rejected — check your key.'
    if (e.kind === 'network') return 'Network error — try again.'
    return e.message
  }
  return 'Something went wrong.'
}

export type VoiceCommand = ReturnType<typeof useVoiceCommand>

/**
 * Command-mode voice: hold, speak an instruction, and it's interpreted against
 * the current section and executed. Lifted into AppShell so a single state
 * drives both the header and sidebar triggers plus one shared toast.
 */
export function useVoiceCommand() {
  const { user } = useAuth()
  const { pathname } = useLocation()
  const [phase, setPhase] = useState<Phase>('idle')
  const [message, setMessage] = useState('')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flash = useCallback((to: Phase, text: string, ms = 3200) => {
    setPhase(to)
    setMessage(text)
    if (timerRef.current) clearTimeout(timerRef.current)
    if (to === 'done' || to === 'error') {
      timerRef.current = setTimeout(() => setPhase('idle'), ms)
    }
  }, [])

  const onResult = useCallback(
    async (blob: Blob) => {
      if (!user) return
      flash('working', 'Listening…')
      try {
        const lists = await loadLists(user.uid)
        const transcript = await transcribe(blob)
        if (!transcript) return flash('error', "Didn't catch that — try again.")
        const section = SECTION_BY_PATH[pathname] ?? 'todos'
        const actions = await interpret({
          transcript,
          section,
          listTitles: lists.map((l) => l.title),
          nowISO: localNowISO(),
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        })
        const result = await executeActions(user.uid, actions, lists)
        flash(result.ok ? 'done' : 'error', result.summary)
      } catch (e) {
        flash('error', errorMessage(e))
      }
    },
    [user, pathname, flash],
  )

  const { recording, bind } = useHoldToTalk({
    onResult,
    onEmpty: () => flash('error', "Didn't catch that — hold and speak."),
    onMicBlocked: () => flash('error', 'Microphone blocked — allow mic access.'),
    disabled: phase === 'working',
  })

  return {
    enabled: hasVoiceKeys && !!user,
    recording,
    working: phase === 'working',
    phase,
    message,
    bind,
  }
}

/**
 * Floating graphite-glass command mic, shown on Tasks & Lists. Understated at
 * rest; a soft red glow while recording.
 */
export function VoiceFab({ voice }: { voice: VoiceCommand }) {
  const { pathname } = useLocation()
  if (!voice.enabled || !FAB_PATHS.has(pathname)) return null
  return (
    <button
      aria-label="Hold to talk"
      disabled={voice.working}
      style={{ touchAction: 'none' }}
      {...voice.bind}
      className={`press safe-bottom fixed bottom-24 right-5 z-40 grid h-[52px] w-[52px] place-items-center rounded-full border border-white/10 text-white shadow-float backdrop-blur-xl transition-colors md:bottom-8 ${
        voice.recording ? 'bg-[#FF375F]/90' : 'bg-ink/80 hover:bg-ink/90'
      }`}
    >
      {voice.recording && (
        <span className="absolute inset-0 animate-ping rounded-full bg-[#FF375F]/30" />
      )}
      {voice.working ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
      ) : (
        <MicIcon className="h-6 w-6" />
      )}
    </button>
  )
}

/** Single shared status pill, rendered once at the app root. */
export function VoiceToast({ voice }: { voice: VoiceCommand }) {
  const show = voice.recording || voice.phase === 'working' || voice.phase === 'done' || voice.phase === 'error'
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          className="safe-bottom fixed bottom-24 left-1/2 z-40 w-max max-w-[calc(100vw-2.5rem)] -translate-x-1/2 md:bottom-8"
        >
          <div
            className={`card flex items-center gap-2 px-4 py-2.5 text-sm font-medium ${
              voice.phase === 'error' ? 'text-[#FF375F]' : 'text-ink'
            }`}
          >
            {voice.recording && (
              <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-[#FF375F]" />
            )}
            {voice.working && (
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-hair border-t-accent" />
            )}
            <span className="truncate">
              {voice.recording ? 'Listening… release to send' : voice.message}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
