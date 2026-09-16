/**
 * Shared hold-to-talk recorder. Manages mic permission, MediaRecorder, and the
 * press/release lifecycle; hands the finished audio Blob back via onResult.
 * Both the command mic (top bar) and the dictation mic (note editor) use this.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

// Ignore accidental taps: a real hold is at least this long.
const DEFAULT_MIN_HOLD_MS = 350

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) return t
  }
  return ''
}

export interface HoldToTalkOptions {
  /** Fired with recorded audio when a real (long-enough, non-empty) hold ends. */
  onResult: (blob: Blob) => void
  /** Held long enough but no audio captured — likely "didn't catch that". */
  onEmpty?: () => void
  /** getUserMedia was denied/unavailable. */
  onMicBlocked?: () => void
  /** Prevent starting a new recording (e.g. while the last one is processing). */
  disabled?: boolean
  minHoldMs?: number
}

export interface HoldToTalkBind {
  onPointerDown: (e: ReactPointerEvent) => void
  onPointerUp: (e: ReactPointerEvent) => void
  onPointerLeave: () => void
  onPointerCancel: () => void
  onContextMenu: (e: ReactMouseEvent) => void
}

export function useHoldToTalk(opts: HoldToTalkOptions): {
  recording: boolean
  bind: HoldToTalkBind
} {
  const { minHoldMs = DEFAULT_MIN_HOLD_MS } = opts
  const [recording, setRecording] = useState(false)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startedAtRef = useRef(0)

  // Keep latest callbacks/flags reachable inside recorder events without re-binding.
  const cfg = useRef(opts)
  useEffect(() => {
    cfg.current = opts
  })

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  const start = useCallback(async () => {
    if (cfg.current.disabled || recorderRef.current) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        // Mono + noise handling keeps the upload small and speech-clean, which
        // matters a lot on mobile connections.
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      cfg.current.onMicBlocked?.()
      return
    }
    streamRef.current = stream
    chunksRef.current = []
    const mimeType = pickMimeType()
    const rec = new MediaRecorder(stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 32_000, // ~4 KB/s — plenty for speech, tiny to upload
    })
    rec.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data)
    }
    rec.onstop = () => {
      const type = rec.mimeType || mimeType || 'audio/webm'
      const blob = new Blob(chunksRef.current, { type })
      cleanup()
      setRecording(false)
      if (blob.size < 1200) cfg.current.onEmpty?.()
      else cfg.current.onResult(blob)
    }
    recorderRef.current = rec
    startedAtRef.current = Date.now()
    rec.start()
    setRecording(true)
  }, [cleanup])

  const stop = useCallback(() => {
    const rec = recorderRef.current
    if (!rec || rec.state === 'inactive') return
    const held = Date.now() - startedAtRef.current
    if (held < minHoldMs) {
      // Too short to be intentional — discard without transcribing.
      rec.onstop = null
      try {
        rec.stop()
      } catch {
        /* ignore */
      }
      cleanup()
      setRecording(false)
      return
    }
    try {
      rec.stop()
    } catch {
      cleanup()
      setRecording(false)
    }
  }, [cleanup, minHoldMs])

  const bind: HoldToTalkBind = {
    onPointerDown: (e) => {
      e.preventDefault()
      void start()
    },
    onPointerUp: (e) => {
      e.preventDefault()
      stop()
    },
    onPointerLeave: () => {
      if (recording) stop()
    },
    onPointerCancel: () => {
      if (recording) stop()
    },
    onContextMenu: (e) => e.preventDefault(),
  }

  return { recording, bind }
}
