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
  '/tasks': 'tasks',
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
      flash('working', 'Transcribing…')
      try {
        // Read lists in parallel with transcription — neither needs the other.
        const listsPromise = loadLists(user.uid)
        const transcript = await transcribe(blob)
        if (!transcript) return flash('error', "Didn't catch that — try again.")
        flash('working', 'Thinking…')
        const lists = await listsPromise
        const section = SECTION_BY_PATH[pathname] ?? 'tasks'
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
      draggable={false}
      style={{
        touchAction: 'none',
        WebkitUserSelect: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
      }}
      {...voice.bind}
      className={`press fixed right-5 z-40 grid h-[54px] w-[54px] select-none place-items-center rounded-full border shadow-float backdrop-blur-xl transition-colors bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-8 ${
        voice.recording
          ? 'border-transparent bg-[#FF375F] text-white'
          : 'border-black/[0.06] bg-white/60 text-ink hover:bg-white/80'
      }`}
    >
      {voice.recording && (
        <span className="pointer-events-none absolute inset-0 animate-ping rounded-full bg-[#FF375F]/30" />
      )}
      {voice.working ? (
        <span className="h-5 w-5 animate-spin rounded-full border-2 border-ink/20 border-t-ink" />
      ) : (
        <MicIcon className="h-6 w-6" />
      )}
    </button>
  )
}

/**
 * Result pill — only shown after a command finishes (success or error). The
 * recording/processing states are conveyed by the mic button's own animation.
 */
export function VoiceToast({ voice }: { voice: VoiceCommand }) {
  const show = voice.working || voice.phase === 'done' || voice.phase === 'error'
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.96 }}
          className="fixed left-1/2 z-40 w-max max-w-[calc(100vw-2.5rem)] -translate-x-1/2 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-8"
        >
          <div
            className={`card flex items-center gap-2 px-4 py-2.5 text-sm font-medium ${
              voice.phase === 'error' ? 'text-[#FF375F]' : 'text-ink'
            }`}
          >
            {voice.working && (
              <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-hair border-t-accent" />
            )}
            <span className="truncate">{voice.message}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
